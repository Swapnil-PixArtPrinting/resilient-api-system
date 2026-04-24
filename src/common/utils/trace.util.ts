import { v4 as uuidv4 } from "uuid";

/**
 * Generates a unique trace ID (UUIDv4) to correlate logs across a single request lifecycle.
 */
export const generateTraceId = (): string => uuidv4();
