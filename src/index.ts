// Entry point — wired up in the WIRE prompt.
// Each module import will be added incrementally.
import pino from "pino";

const logger = pino({ level: process.env.LOG_LEVEL ?? "info" });

logger.info("sre-agent starting");

// TODO: module wiring added in WIRE prompt
