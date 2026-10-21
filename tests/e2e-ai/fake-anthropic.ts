// AI E2E 용 가짜 Anthropic 서버(127.0.0.1:3299). 실제 API 가 아니다.
// 제어: POST /__mode {mode:'ok'|'401'}  /  GET /__calls → 받은 호출 목록(본문 포함)
import { createServer } from 'node:http';

const PORT = 3299;
let mode = 'ok';
const calls: { key: string | undefined; body: any }[] = [];
const QUOTE_1 = '가능한 날짜를 보고';
const QUOTE_2 = '홈페이지에서 촬영 예약을 받았으면 좋겠어요';

createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const text = Buffer.concat(chunks).toString('utf8');
    const json = (status: number, v: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(v));
    };
    if (req.url === '/health') return json(200, { ok: true });
    if (req.url === '/__calls') return json(200, calls);
    if (req.url === '/__mode') {
      mode = JSON.parse(text).mode;
      return json(200, { mode });
    }
    calls.push({ key: req.headers['x-api-key'] as string | undefined, body: JSON.parse(text || 'null') });
    if (mode === '401') {
      return json(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key sk-ant-e2e-fake-KEY' } });
    }
    const result = {
      requirements: [
        { content: '예약 가능한 날짜 조회', quote: QUOTE_1 },
        { content: '고객의 촬영 예약 신청', quote: QUOTE_2 },
      ],
      questions: [{ content: '결제가 필요한가요?', note: '원문에 결제 이야기가 없어요.' }],
      undecided: [{ content: '로그인 필요 여부', note: '고객이 정하지 않았어요.' }],
    };
    json(200, {
      id: 'msg_e2e',
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      content: [{ type: 'text', text: JSON.stringify(result) }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 200, output_tokens: 80 },
    });
  });
}).listen(PORT, '127.0.0.1', () => console.log(`가짜 Anthropic 서버: http://127.0.0.1:${PORT}`));
