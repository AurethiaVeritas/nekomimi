import type { AuthUser } from '../server/types';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
