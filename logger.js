const winston = require("winston");
require("winston-daily-rotate-file");
const path = require("path");

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, "logs");
require("fs").mkdirSync(logsDir, { recursive: true });

// Configure daily rotate file transport
const fileRotateTransport = new winston.transports.DailyRotateFile({
  filename: path.join(logsDir, "wotd-bot-%DATE%.log"),
  datePattern: "YYYY-MM-DD",
  maxFiles: "14d", // Keep logs for 14 days
  maxSize: "20m", // Rotate if size exceeds 20MB
  zippedArchive: true,
  format: logFormat,
});

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: logFormat,
  transports: [
    fileRotateTransport,
    // Also log to console in development
    ...(process.env.NODE_ENV !== "production"
      ? [
          new winston.transports.Console({
            format: winston.format.combine(
              winston.format.colorize(),
              winston.format.simple()
            ),
          }),
        ]
      : []),
  ],
});

// Handle rotate events
fileRotateTransport.on("rotate", function (oldFilename, newFilename) {
  logger.info("Log file rotated", { oldFilename, newFilename });
});

module.exports = logger;
