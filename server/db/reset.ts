import { rmSync } from 'node:fs';
import { DB_PATH } from '../config.ts';
import { openDb } from './open.ts';
import { migrate } from './migrate.ts';
import { seed } from './seed.ts';

// 사용법: npm run db:reset [-- --morning-analysis] [-- --empty]
//   (기본) 파일 DB 를 지우고 마이그레이션 + 샘플 3건 시드
//   --morning-analysis  첫 요청에 §8 샘플 분석 항목(모의 제안)을 함께 넣는다
//   --empty             마이그레이션만 하고 시드하지 않는다(첫 사용 상태)
const args = process.argv.slice(2);
for (const suffix of ['', '-wal', '-shm']) rmSync(DB_PATH + suffix, { force: true });
const db = openDb(DB_PATH);
const applied = migrate(db);
if (!args.includes('--empty')) seed(db, { withMorningAnalysis: args.includes('--morning-analysis') });
db.close();
console.log(`DB 초기화 완료: ${DB_PATH} (마이그레이션 ${applied.join(', ')})${args.includes('--empty') ? ' · 시드 없음' : ''}`);
