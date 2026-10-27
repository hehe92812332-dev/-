/** API 오류 (상태 코드 + 사용자에게 보여줄 메시지) */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
