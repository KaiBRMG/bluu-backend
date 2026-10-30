/**
 * An error that carries the HTTP status it should become. Thrown by the training
 * services and mapped to a response once, by `withCandidate` / `withTrainingAdmin`.
 * Dependency-free so a middleware can import it without pulling in a service.
 */
export class TrainingError extends Error {
  constructor(
    message: string,
    public status: number,
    /** A stable code for the page to act on (`attempt-ended`), where the status alone is ambiguous. */
    public code?: string,
  ) {
    super(message);
  }
}
