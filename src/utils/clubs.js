import pg from './db.js';

const CLUBS_API_KEY = process.env.HACKCLUB_CLUBS_API_KEY;
const CLUBS_API_BASE = 'https://clubapi.hackclub.com';

const clubInfoCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

async function callClubsAPI(path, params = {}, requireAuth = true) {
  const url = new URL(`${CLUBS_API_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) {
      url.searchParams.set(k, v);
    }
  });

  const headers = {};
  if (requireAuth) {
    if (!CLUBS_API_KEY) {
      throw new Error('Clubs API key not configured');
    }
    headers['Authorization'] = CLUBS_API_KEY;
  }

  const resp = await fetch(url.toString(), { headers });

  if (!resp.ok) {
    if (resp.status === 404) {
      return null;
    }
    throw new Error(`Clubs API error: ${resp.status}`);
  }

  const contentType = resp.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    const text = (await resp.text()).trim();
    if (!text || text.toLowerCase().includes('not found')) {
      return null;
    }
    return { _plainText: text };
  }

  return resp.json();
}

export async function getOrCreateClubByName(clubName) {
  if (!clubName) {
    return null;
  }

  let club = await pg('clubs')
    .where('club_name', clubName)
    .first();

  if (club) {
    return club;
  }

  try {
    const clubInfo = await callClubsAPI('/club', { name: clubName }, false);
    
    const [newClub] = await pg('clubs')
      .insert({
        club_name: clubName,
        display_name: clubInfo?.club_name || clubName,
        country: clubInfo?.venue_address_country,
        metadata: clubInfo ? JSON.stringify(clubInfo) : null,
        last_synced_at: new Date()
      })
      .onConflict('club_name')
      .merge(['display_name', 'country', 'metadata', 'last_synced_at'])
      .returning('*');

    return newClub;
  } catch (error) {
    console.error('Error creating club:', error);
    const [newClub] = await pg('clubs')
      .insert({
        club_name: clubName,
        last_synced_at: new Date()
      })
      .onConflict('club_name')
      .ignore()
      .returning('*');

    return newClub || await pg('clubs').where('club_name', clubName).first();
  }
}

export async function checkLeaderStatus(email) {
  if (!email) {
    return { isLeader: false, clubName: null };
  }

  try {
    const result = await callClubsAPI('/leader', { email }, true);
    
    if (result?.club_name) {
      return { isLeader: true, clubName: result.club_name };
    }
    
    if (result?.leader === true) {
      return { isLeader: true, clubName: null };
    }

    return { isLeader: false, clubName: null };
  } catch (error) {
    console.error('Error checking leader status:', error);
    return { isLeader: false, clubName: null };
  }
}

export async function checkMemberStatus(email) {
  if (!email) {
    return { isMember: false, clubName: null };
  }

  try {
    const result = await callClubsAPI('/member/email', { email }, true);
    
    if (!result) {
      return { isMember: false, clubName: null };
    }

    if (result._plainText) {
      return { isMember: true, clubName: result._plainText };
    }
    
    if (result.club_name) {
      return { isMember: true, clubName: result.club_name };
    }

    return { isMember: false, clubName: null };
  } catch (error) {
    console.error('Error checking member status:', error);
    return { isMember: false, clubName: null };
  }
}

export async function checkClubAffiliation(email) {
  if (!email) {
    return { affiliated: false, role: null, clubName: null };
  }

  const { isLeader, clubName: leaderClubName } = await checkLeaderStatus(email);
  if (isLeader && leaderClubName) {
    return { affiliated: true, role: 'leader', clubName: leaderClubName };
  }

  const { isMember, clubName: memberClubName } = await checkMemberStatus(email);
  if (isMember && memberClubName) {
    return { affiliated: true, role: 'member', clubName: memberClubName };
  }

  return { affiliated: false, role: null, clubName: null };
}

/**
 * Links a user to a club with a specific role.
 * 
 * SECURITY: This function must ONLY be called with:
 *   - userId derived from an authenticated token (via getUser())
 *   - clubId derived from a trusted database/API lookup (never from client input)
 *   - role and source verified server-side
 * 
 * DO NOT expose this function directly to client-supplied parameters.
 * Misuse could allow users to assign themselves as leaders of arbitrary clubs.
 */
export async function linkUserToClub(userId, clubId, role, source) {
  if (!userId || !clubId || !role) {
    throw new Error('User ID, club ID, and role are required');
  }

  const validRoles = ['leader', 'member'];
  if (!validRoles.includes(role)) {
    throw new Error('Invalid role');
  }

  const validSources = ['leader_email', 'member_lookup'];
  if (!validSources.includes(source)) {
    throw new Error('Invalid source');
  }

  const existingMembership = await pg('user_club_memberships')
    .where({ user_id: userId, club_id: clubId })
    .first();

  if (existingMembership) {
    const [updated] = await pg('user_club_memberships')
      .where({ user_id: userId, club_id: clubId })
      .update({
        role,
        source,
        last_verified_at: new Date(),
        updated_at: new Date()
      })
      .returning('*');
    return updated;
  }

  await pg('user_club_memberships')
    .where({ user_id: userId, is_primary: true })
    .update({ is_primary: false });

  const [membership] = await pg('user_club_memberships')
    .insert({
      user_id: userId,
      club_id: clubId,
      role,
      source,
      is_primary: true,
      last_verified_at: new Date()
    })
    .returning('*');

  return membership;
}

export async function getUserPrimaryMembership(userId) {
  if (!userId) {
    return null;
  }

  const membership = await pg('user_club_memberships')
    .join('clubs', 'user_club_memberships.club_id', 'clubs.id')
    .where('user_club_memberships.user_id', userId)
    .where('user_club_memberships.is_primary', true)
    .select(
      'user_club_memberships.*',
      'clubs.club_name',
      'clubs.display_name',
      'clubs.country',
      'clubs.metadata'
    )
    .first();

  return membership;
}

export async function getUserMemberships(userId) {
  if (!userId) {
    return [];
  }

  const memberships = await pg('user_club_memberships')
    .join('clubs', 'user_club_memberships.club_id', 'clubs.id')
    .where('user_club_memberships.user_id', userId)
    .select(
      'user_club_memberships.*',
      'clubs.club_name',
      'clubs.display_name',
      'clubs.country',
      'clubs.metadata'
    );

  return memberships;
}

export async function getLeaderMemberships(userId) {
  if (!userId) {
    return [];
  }

  const memberships = await pg('user_club_memberships')
    .join('clubs', 'user_club_memberships.club_id', 'clubs.id')
    .where('user_club_memberships.user_id', userId)
    .where('user_club_memberships.role', 'leader')
    .select(
      'user_club_memberships.*',
      'clubs.club_name',
      'clubs.display_name',
      'clubs.country',
      'clubs.metadata'
    );

  return memberships;
}

export async function getClubShips(clubName) {
  if (!clubName) {
    return [];
  }

  const cacheKey = `ships:${clubName}`;
  const cached = clubInfoCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const ships = await callClubsAPI('/ships', { club_name: clubName }, false);
    
    clubInfoCache.set(cacheKey, {
      data: ships || [],
      timestamp: Date.now()
    });

    return ships || [];
  } catch (error) {
    console.error('Error fetching club ships:', error);
    return cached?.data || [];
  }
}

export async function getClubInfo(clubName) {
  if (!clubName) {
    return null;
  }

  const cacheKey = `info:${clubName}`;
  const cached = clubInfoCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const info = await callClubsAPI('/club', { name: clubName }, true);
    
    if (info) {
      clubInfoCache.set(cacheKey, {
        data: info,
        timestamp: Date.now()
      });
    }

    return info;
  } catch (error) {
    console.error('Error fetching club info:', error);
    return cached?.data || null;
  }
}

export async function getClubLevel(clubName) {
  if (!clubName) {
    return null;
  }

  try {
    const result = await callClubsAPI('/level', { club_name: clubName }, false);
    return result?.level || null;
  } catch (error) {
    console.error('Error fetching club level:', error);
    return null;
  }
}

export async function getClubStatus(clubName) {
  if (!clubName) {
    return null;
  }

  try {
    const result = await callClubsAPI('/status', { club_name: clubName }, false);
    return result?.status || null;
  } catch (error) {
    console.error('Error fetching club status:', error);
    return null;
  }
}

export async function getClubMembers(clubName) {
  if (!clubName) {
    return null;
  }

  try {
    const result = await callClubsAPI('/members', { club_name: clubName }, true);
    return result?.members || null;
  } catch (error) {
    console.error('Error fetching club members:', error);
    return null;
  }
}

export async function refreshMembershipIfStale(userId, maxAgeHours = 24) {
  const membership = await getUserPrimaryMembership(userId);
  
  if (!membership) {
    return null;
  }

  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  const lastVerified = new Date(membership.last_verified_at);
  
  if (Date.now() - lastVerified.getTime() < maxAgeMs) {
    return membership;
  }

  const user = await pg('users').where('id', userId).first();
  if (!user) {
    return membership;
  }

  const { isLeader, clubName } = await checkLeaderStatus(user.email);
  
  if (!isLeader || !clubName) {
    await pg('user_club_memberships')
      .where('id', membership.id)
      .update({
        role: 'member',
        last_verified_at: new Date(),
        updated_at: new Date()
      });
    
    return getUserPrimaryMembership(userId);
  }

  if (clubName !== membership.club_name) {
    const newClub = await getOrCreateClubByName(clubName);
    if (newClub) {
      await linkUserToClub(userId, newClub.id, 'leader', 'leader_email');
    }
    return getUserPrimaryMembership(userId);
  }

  await pg('user_club_memberships')
    .where('id', membership.id)
    .update({
      last_verified_at: new Date(),
      updated_at: new Date()
    });

  return getUserPrimaryMembership(userId);
}

export async function shareSpaceWithClub(spaceId, clubId, userId) {
  if (!spaceId || !clubId || !userId) {
    throw new Error('Space ID, club ID, and user ID are required');
  }

  const existing = await pg('space_club_shares')
    .where({ space_id: spaceId, club_id: clubId })
    .whereNull('revoked_at')
    .first();

  if (existing) {
    return existing;
  }

  const [share] = await pg('space_club_shares')
    .insert({
      space_id: spaceId,
      club_id: clubId,
      shared_by_user_id: userId,
      permission: 'read'
    })
    .returning('*');

  return share;
}

export async function revokeSpaceClubShare(spaceId, clubId) {
  if (!spaceId || !clubId) {
    throw new Error('Space ID and club ID are required');
  }

  await pg('space_club_shares')
    .where({ space_id: spaceId, club_id: clubId })
    .whereNull('revoked_at')
    .update({ revoked_at: new Date() });
}

export async function getSpaceShareStatus(spaceId) {
  if (!spaceId) {
    return null;
  }

  const share = await pg('space_club_shares')
    .join('clubs', 'space_club_shares.club_id', 'clubs.id')
    .where('space_club_shares.space_id', spaceId)
    .whereNull('space_club_shares.revoked_at')
    .select('space_club_shares.*', 'clubs.club_name', 'clubs.display_name')
    .first();

  return share;
}

export async function getSpacesSharedWithLeader(userId) {
  if (!userId) {
    return [];
  }

  const leaderMemberships = await getLeaderMemberships(userId);
  
  if (leaderMemberships.length === 0) {
    return [];
  }

  const clubIds = leaderMemberships.map(m => m.club_id);

  const sharedSpaces = await pg('space_club_shares')
    .join('spaces', 'space_club_shares.space_id', 'spaces.id')
    .join('users', 'spaces.user_id', 'users.id')
    .join('clubs', 'space_club_shares.club_id', 'clubs.id')
    .whereIn('space_club_shares.club_id', clubIds)
    .whereNull('space_club_shares.revoked_at')
    .select(
      'spaces.id as space_id',
      'spaces.type',
      'spaces.description',
      'spaces.access_url',
      'spaces.running',
      'spaces.created_at',
      'users.id as owner_id',
      'users.username as owner_username',
      'clubs.club_name',
      'clubs.display_name as club_display_name',
      'space_club_shares.permission',
      'space_club_shares.created_at as shared_at'
    );

  return sharedSpaces;
}

export async function unlinkUserFromClub(userId, clubId) {
  if (!userId || !clubId) {
    throw new Error('User ID and club ID are required');
  }

  await pg('user_club_memberships')
    .where({ user_id: userId, club_id: clubId })
    .delete();
}
