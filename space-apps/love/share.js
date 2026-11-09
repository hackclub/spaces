export { SHARE_LIMIT, readShareHash } from './share.original.js';

export async function createShareLink() {
  throw new Error('Your space is private, so a share link to it would ask for your password. To share your game, export it as a .love file or for the web instead.');
}
