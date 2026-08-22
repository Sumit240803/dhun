// Redis: presence, room/seat state, leaderboards (sorted sets), rate limiting.
import Redis from 'ioredis';
import { config } from '../config/index.js';

export const redis = new Redis(config.redisUrl);
