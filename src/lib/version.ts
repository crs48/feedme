import { version } from '../../package.json';
import { databaseVersion } from './database-migrations';

export const releaseInfo = {
  version,
  databaseVersion,
  releasesUrl: 'https://github.com/crs48/feedme/releases',
  upgradeGuideUrl: 'https://github.com/crs48/feedme/blob/main/docs/releases.md',
} as const;
