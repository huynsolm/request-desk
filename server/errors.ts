export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fieldErrors?: Record<string, string>,
  ) {
    super(message);
  }
}

const DB_MESSAGES: Record<string, [number, string]> = {
  locked_confirmed: [409, '확정된 요청이에요. 먼저 ‘다시 검토하기’로 새 검토 버전을 시작해 주세요.'],
  quote_not_in_original: [422, '근거 문장이 원문에 그대로 있어야 해요.'],
  edit_requires_rereview: [500, '내용을 고치면 검토 전 상태로 바뀌어야 해요.'],
  immutable_confirmation: [409, '확정 기록은 바꿀 수 없어요.'],
  task_requires_requirement: [422, '명시된 요구사항으로만 작업을 만들 수 있어요.'],
  task_source_mismatch: [422, '작업과 요구사항 연결이 맞지 않아요.'],
  request_delete_not_allowed: [409, '요청은 삭제할 수 없어요.'],
  resolution_required: [422, '질문과 미확정 사항에는 해결 상태가 있어야 해요.'],
  task_link_immutable: [409, '작업과 요구사항의 연결은 바꿀 수 없어요.'],
  immutable_original: [409, '원문 개정판은 바꿀 수 없어요.'],
  immutable_analysis_run: [409, '끝난 분석 기록은 바꿀 수 없어요.'],
  last_criterion: [422, '작업에는 완료 조건이 하나 이상 있어야 해요.'],
};

/** SQLite 오류를 사용자에게 보여줄 AppError 로 바꾼다. */
export function translateDbError(err: unknown): AppError | null {
  const msg = err instanceof Error ? err.message : String(err);
  for (const [key, [status, message]] of Object.entries(DB_MESSAGES)) {
    if (msg.includes(key)) return new AppError(status, key, message);
  }
  if (msg.includes('UNIQUE constraint failed: tasks.')) {
    return new AppError(409, 'task_exists', '이미 이 요구사항으로 만든 작업이 있어요.');
  }
  if (msg.includes('UNIQUE constraint failed')) return new AppError(409, 'conflict', '이미 같은 데이터가 있어요.');
  if (msg.includes('CHECK constraint failed')) {
    return new AppError(422, 'check_failed', '입력한 내용이 저장 규칙에 맞지 않아요.');
  }
  if (msg.includes('FOREIGN KEY constraint failed')) {
    return new AppError(409, 'fk_failed', '연결된 데이터가 맞지 않아요.');
  }
  return null;
}
