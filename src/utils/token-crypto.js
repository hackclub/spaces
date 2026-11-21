import crypto from 'crypto';

export const createTokenCrypto = (envName) => {
  const key = () => {
    const decoded = Buffer.from(process.env[envName] || '', 'base64');
    return decoded.length === 32 ? decoded : null;
  };

  const encrypt = (token) => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
    const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
  };

  const decrypt = (stored) => {
    const secret = key();
    if (!secret || typeof stored !== 'string') return null;
    const [version, iv, tag, data] = stored.split('.');
    if (version !== 'v1' || !iv || !tag || !data) return null;
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', secret, Buffer.from(iv, 'base64'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
    } catch {
      return null;
    }
  };

  return { configured: () => Boolean(key()), encrypt, decrypt };
};
