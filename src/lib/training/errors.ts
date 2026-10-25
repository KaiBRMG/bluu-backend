/**
 * An error that carries the HTTP status it should become. Thrown by the training
 * services and mapped to a response once, by `withCandidate` / `withTrainingAdmin`.
 * Dependency-free so a middleware can import it without pulling in a service.
 */
export class TrainingError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
