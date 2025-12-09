import express from 'express';
import crypto from 'crypto';
import pg from '../../utils/db.js';
import { getUser } from '../../utils/user.js';

const router = express.Router();

const HACKCLUB_AUTH_URL = 'https://auth.hackclub.com/oauth/authorize';
const HACKCLUB_TOKEN_URL = 'https://auth.hackclub.com/oauth/token';
const HACKCLUB_ME_URL = 'https://auth.hackclub.com/api/v1/me';

const randomToken = () => crypto.randomBytes(32).toString('hex');

const generateState = () => crypto.randomBytes(32).toString('hex');

async function cleanupExpiredStates() {
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  await pg('oauth_states').where('created_at', '<', tenMinutesAgo).delete();
}

router.get('/hackclub/login', async (req, res) => {
  try {
    await cleanupExpiredStates();
    
    const state = generateState();
    
    await pg('oauth_states').insert({
      state,
      mode: 'login',
      user_id: null,
      created_at: new Date()
    });

    const url = new URL(HACKCLUB_AUTH_URL);
    url.searchParams.set('client_id', process.env.HACKCLUB_CLIENT_ID);
    url.searchParams.set('redirect_uri', process.env.HACKCLUB_REDIRECT_URI);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'email name verification_status');
    url.searchParams.set('state', state);

    res.redirect(url.toString());
  } catch (error) {
    console.error('Error initiating OAuth login:', error);
    res.redirect('/?error=oauth_init_failed');
  }
});

router.post('/hackclub/link', async (req, res) => {
  try {
    const authorization = req.headers.authorization;
    
    if (!authorization) {
      return res.status(401).json({
        success: false,
        message: 'Authorization required to link account'
      });
    }

    const user = await getUser(authorization);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid authorization token'
      });
    }

    if (user.hackclub_id) {
      return res.status(400).json({
        success: false,
        message: 'Account already linked to Hack Club'
      });
    }

    await cleanupExpiredStates();
    
    const state = generateState();
    
    await pg('oauth_states').insert({
      state,
      mode: 'link',
      user_id: user.id,
      created_at: new Date()
    });

    const url = new URL(HACKCLUB_AUTH_URL);
    url.searchParams.set('client_id', process.env.HACKCLUB_CLIENT_ID);
    url.searchParams.set('redirect_uri', process.env.HACKCLUB_REDIRECT_URI);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'email name verification_status');
    url.searchParams.set('state', state);

    res.json({ success: true, url: url.toString() });
  } catch (error) {
    console.error('Error initiating OAuth link:', error);
    res.status(500).json({ success: false, message: 'Failed to initiate account linking' });
  }
});

router.get('/callback', async (req, res) => {
  try {
    const { code, state, error: oauthError } = req.query;

    if (oauthError) {
      console.error('OAuth error from Hack Club:', oauthError);
      return res.redirect('/?error=oauth_denied');
    }

    if (!code || !state) {
      return res.redirect('/?error=oauth_invalid_response');
    }

    const stateRow = await pg('oauth_states').where({ state }).first();
    if (!stateRow) {
      return res.redirect('/?error=oauth_invalid_state');
    }

    const stateAge = Date.now() - new Date(stateRow.created_at).getTime();
    if (stateAge > 10 * 60 * 1000) {
      await pg('oauth_states').where({ state }).delete();
      return res.redirect('/?error=oauth_state_expired');
    }

    await pg('oauth_states').where({ state }).delete();

    console.log('Exchanging code for token with redirect_uri:', process.env.HACKCLUB_REDIRECT_URI);
    
    const tokenBody = new URLSearchParams({
      client_id: process.env.HACKCLUB_CLIENT_ID,
      client_secret: process.env.HACKCLUB_CLIENT_SECRET,
      redirect_uri: process.env.HACKCLUB_REDIRECT_URI,
      code,
      grant_type: 'authorization_code'
    });

    const tokenResponse = await fetch(HACKCLUB_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody.toString()
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', tokenResponse.status, errorText);
      return res.redirect('/?error=oauth_token_failed');
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      return res.redirect('/?error=oauth_no_token');
    }

    const meResponse = await fetch(HACKCLUB_ME_URL, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!meResponse.ok) {
      console.error('Failed to fetch user info, status:', meResponse.status);
      return res.redirect('/?error=oauth_user_fetch_failed');
    }

    const meData = await meResponse.json();
    const identity = meData.identity || meData;
    
    const hackclubId = identity.id;
    const email = identity.primary_email || identity.email;
    const firstName = identity.first_name || 'User';
    const verificationStatus = identity.verification_status || 'needs_submission';

    if (!hackclubId || !email) {
      return res.redirect('/?error=oauth_missing_data');
    }

    let user;

    if (stateRow.mode === 'link') {
      const currentUser = await pg('users').where({ id: stateRow.user_id }).first();
      
      if (!currentUser) {
        return res.redirect('/?error=oauth_link_user_not_found');
      }

      const existingWithHackclubId = await pg('users')
        .where({ hackclub_id: hackclubId })
        .whereNot({ id: currentUser.id })
        .first();

      if (existingWithHackclubId) {
        return res.redirect('/?error=oauth_hackclub_already_linked');
      }

      await pg('users').where({ id: currentUser.id }).update({
        hackclub_id: hackclubId,
        hackclub_verification_status: verificationStatus,
        hackclub_linked_at: new Date()
      });

      user = await pg('users').where({ id: currentUser.id }).first();
    } else {
      user = await pg('users').where({ hackclub_id: hackclubId }).first();
      
      if (!user) {
        user = await pg('users').where({ email }).first();
      }

      if (user) {
        await pg('users').where({ id: user.id }).update({
          hackclub_id: hackclubId,
          hackclub_verification_status: verificationStatus,
          hackclub_linked_at: new Date()
        });
        user = await pg('users').where({ id: user.id }).first();
      } else {
        let username = firstName.toLowerCase().replace(/[^a-z0-9]/g, '');
        if (username.length < 3) {
          username = 'user' + crypto.randomBytes(4).toString('hex');
        }
        
        const existingUsername = await pg('users').where({ username }).first();
        if (existingUsername) {
          username = username + crypto.randomBytes(4).toString('hex');
        }

        const authToken = randomToken();
        
        const [newUser] = await pg('users')
          .insert({
            email,
            username,
            authorization: authToken,
            max_spaces: 3,
            is_admin: false,
            hackclub_id: hackclubId,
            hackclub_verification_status: verificationStatus,
            hackclub_linked_at: new Date()
          })
          .returning(['id', 'email', 'username', 'authorization', 'is_admin', 'hackatime_api_key', 'hackclub_id', 'hackclub_verification_status']);

        user = newUser;
      }
    }

    const newAuthToken = randomToken();
    await pg('users').where({ id: user.id }).update({ authorization: newAuthToken });
    user = await pg('users').where({ id: user.id }).first();

    res.cookie('auth_token', newAuthToken, {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production'
    });

    const userData = {
      authorization: user.authorization,
      username: user.username,
      email: user.email,
      is_admin: user.is_admin,
      hackatime_api_key: user.hackatime_api_key,
      hackclub_id: user.hackclub_id,
      hackclub_verification_status: user.hackclub_verification_status
    };

    const encodedData = encodeURIComponent(JSON.stringify(userData));
    res.redirect(`/#oauth_success=true&user_data=${encodedData}`);

  } catch (error) {
    console.error('OAuth callback error:', error);
    res.redirect('/?error=oauth_callback_failed');
  }
});

router.get('/status', async (req, res) => {
  try {
    const authorization = req.headers.authorization;
    
    if (!authorization) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const user = await getUser(authorization);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }

    res.json({
      success: true,
      data: {
        hackclub_linked: !!user.hackclub_id,
        hackclub_id: user.hackclub_id,
        hackclub_verification_status: user.hackclub_verification_status,
        hackclub_linked_at: user.hackclub_linked_at
      }
    });
  } catch (error) {
    console.error('Error getting OAuth status:', error);
    res.status(500).json({ success: false, message: 'Failed to get OAuth status' });
  }
});

router.post('/refresh-verification', async (req, res) => {
  try {
    const authorization = req.headers.authorization;
    
    if (!authorization) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const user = await getUser(authorization);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }

    const checkResponse = await fetch(
      `https://auth.hackclub.com/api/external/check?email=${encodeURIComponent(user.email)}`
    );

    if (!checkResponse.ok) {
      return res.status(502).json({ 
        success: false, 
        message: 'Unable to verify status with Hack Club' 
      });
    }

    const checkData = await checkResponse.json();
    const newStatus = checkData.result || 'not_found';

    let normalizedStatus = newStatus;
    if (newStatus === 'verified_eligible' || newStatus === 'verified_but_over_18') {
      normalizedStatus = newStatus;
    }

    await pg('users').where({ id: user.id }).update({
      hackclub_verification_status: normalizedStatus,
      hackclub_last_checked_at: new Date()
    });

    res.json({
      success: true,
      data: {
        verification_status: normalizedStatus
      }
    });
  } catch (error) {
    console.error('Error refreshing verification:', error);
    res.status(500).json({ success: false, message: 'Failed to refresh verification status' });
  }
});

router.post('/unlink', async (req, res) => {
  try {
    const authorization = req.headers.authorization;
    
    if (!authorization) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const user = await getUser(authorization);
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid token' });
    }

    if (!user.hackclub_id) {
      return res.status(400).json({ 
        success: false, 
        message: 'No Hack Club account linked' 
      });
    }

    await pg('users').where({ id: user.id }).update({
      hackclub_id: null,
      hackclub_verification_status: null,
      hackclub_linked_at: null,
      hackclub_last_checked_at: null
    });

    res.json({
      success: true,
      message: 'Hack Club account unlinked successfully'
    });
  } catch (error) {
    console.error('Error unlinking account:', error);
    res.status(500).json({ success: false, message: 'Failed to unlink account' });
  }
});

export default router;
