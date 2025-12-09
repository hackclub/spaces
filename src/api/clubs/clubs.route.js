import express from 'express';
import { getUser } from '../../utils/user.js';
import {
  checkClubAffiliation,
  getOrCreateClubByName,
  linkUserToClub,
  getUserPrimaryMembership,
  refreshMembershipIfStale,
  getClubShips,
  getClubInfo,
  getClubLevel,
  getClubStatus,
  getClubMembers,
  unlinkUserFromClub
} from '../../utils/clubs.js';


const router = express.Router();

router.get('/', (req, res) => {
  res.status(200).json({
    message: 'Clubs API Route'
  });
});

router.post('/link', async (req, res) => {
  try {
    const authorization = req.headers.authorization;

    if (!authorization) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const user = await getUser(authorization);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid authorization token'
      });
    }

    const existingMembership = await getUserPrimaryMembership(user.id);
    if (existingMembership) {
      return res.status(400).json({
        success: false,
        message: 'You are already linked to a club. Unlink first to link to a different club.'
      });
    }

    const { affiliated, role, clubName } = await checkClubAffiliation(user.email);

    if (!affiliated || !clubName) {
      return res.status(404).json({
        success: false,
        message: 'No club found for your account. Make sure you are registered as a leader or member with your email.'
      });
    }

    const club = await getOrCreateClubByName(clubName);
    if (!club) {
      return res.status(500).json({
        success: false,
        message: 'Failed to create club record'
      });
    }

    const source = role === 'leader' ? 'leader_email' : 'member_lookup';
    const membership = await linkUserToClub(user.id, club.id, role, source);

    res.status(200).json({
      success: true,
      message: `Successfully linked to club as ${role}`,
      data: {
        clubName: club.club_name,
        displayName: club.display_name,
        role: membership.role,
        linkedAt: membership.created_at
      }
    });
  } catch (error) {
    console.error('Error in /link route:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to link club',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.post('/unlink', async (req, res) => {
  try {
    const authorization = req.headers.authorization;

    if (!authorization) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const user = await getUser(authorization);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid authorization token'
      });
    }

    const membership = await getUserPrimaryMembership(user.id);
    if (!membership) {
      return res.status(400).json({
        success: false,
        message: 'You are not linked to any club'
      });
    }

    await unlinkUserFromClub(user.id, membership.club_id);

    res.status(200).json({
      success: true,
      message: 'Successfully unlinked from club'
    });
  } catch (error) {
    console.error('Error in /unlink route:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to unlink club',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.get('/me', async (req, res) => {
  try {
    const authorization = req.headers.authorization;

    if (!authorization) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const user = await getUser(authorization);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid authorization token'
      });
    }

    const membership = await refreshMembershipIfStale(user.id, 24);

    if (!membership) {
      return res.status(200).json({
        success: true,
        data: {
          club: null,
          message: 'No club linked to your account'
        }
      });
    }

    let metadata = membership.metadata;
    if (typeof metadata === 'string') {
      try {
        metadata = JSON.parse(metadata);
      } catch (e) {
        metadata = null;
      }
    }

    res.status(200).json({
      success: true,
      data: {
        club: {
          name: membership.club_name,
          displayName: membership.display_name || membership.club_name,
          country: membership.country,
          role: membership.role,
          isPrimary: membership.is_primary,
          lastVerifiedAt: membership.last_verified_at,
          metadata: metadata ? {
            attendees: metadata['Est. # of Attendees'],
            meetingDays: metadata.call_meeting_days,
            meetingLength: metadata.call_meeting_length,
            status: metadata.club_status,
            level: metadata.level
          } : null
        }
      }
    });
  } catch (error) {
    console.error('Error in /me route:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get club info',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.get('/me/details', async (req, res) => {
  try {
    const authorization = req.headers.authorization;

    if (!authorization) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const user = await getUser(authorization);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid authorization token'
      });
    }

    const membership = await getUserPrimaryMembership(user.id);
    if (!membership) {
      return res.status(404).json({
        success: false,
        message: 'No club linked to your account'
      });
    }

    const [info, level, status] = await Promise.all([
      getClubInfo(membership.club_name),
      getClubLevel(membership.club_name),
      getClubStatus(membership.club_name)
    ]);

    res.status(200).json({
      success: true,
      data: {
        clubName: membership.club_name,
        displayName: membership.display_name,
        role: membership.role,
        info: info ? {
          attendees: info['Est. # of Attendees'],
          meetingDays: info.call_meeting_days,
          meetingLength: info.call_meeting_length,
          country: info.venue_address_country
        } : null,
        level,
        status
      }
    });
  } catch (error) {
    console.error('Error in /me/details route:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get club details',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.get('/me/ships', async (req, res) => {
  try {
    const authorization = req.headers.authorization;

    if (!authorization) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const user = await getUser(authorization);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid authorization token'
      });
    }

    const membership = await getUserPrimaryMembership(user.id);
    if (!membership) {
      return res.status(404).json({
        success: false,
        message: 'No club linked to your account'
      });
    }

    const ships = await getClubShips(membership.club_name);

    res.status(200).json({
      success: true,
      data: {
        clubName: membership.club_name,
        ships: ships.map(ship => ({
          workshop: ship.workshop,
          rating: ship.Rating,
          codeUrl: ship.code_url,
          ysws: ship['YSWS–Name (from Unified YSWS Database)']
        }))
      }
    });
  } catch (error) {
    console.error('Error in /me/ships route:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get club ships',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.get('/me/members', async (req, res) => {
  try {
    const authorization = req.headers.authorization;

    if (!authorization) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const user = await getUser(authorization);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid authorization token'
      });
    }

    const membership = await getUserPrimaryMembership(user.id);
    if (!membership) {
      return res.status(404).json({
        success: false,
        message: 'No club linked to your account'
      });
    }

    if (membership.role !== 'leader') {
      return res.status(403).json({
        success: false,
        message: 'Only club leaders can view member list'
      });
    }

    const rawMembers = await getClubMembers(membership.club_name);

    res.status(200).json({
      success: true,
      data: {
        clubName: membership.club_name,
        members: rawMembers
      }
    });
  } catch (error) {
    console.error('Error in /me/members route:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get club members',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;
