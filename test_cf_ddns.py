#!/usr/bin/env python3

import logging
import os
import tempfile
from pathlib import Path

import cf_ddns


def reset_logger():
    logger = logging.getLogger("cf_ddns")
    for handler in logger.handlers[:]:
        handler.close()
        logger.removeHandler(handler)
    cf_ddns.LOGGER = None


def main():
    assert cf_ddns.parse_ip("IP\t: 203.0.113.10") == "203.0.113.10"

    with tempfile.TemporaryDirectory() as tmp:
        log_file = Path(tmp) / "cf-ddns.log"
        os.environ["CF_LOG_FILE"] = str(log_file)
        cf_ddns.LOG_MAX_BYTES = 64
        cf_ddns.LOG_BACKUP_COUNT = 1
        reset_logger()

        for _ in range(8):
            cf_ddns.log("x" * 32)

        assert log_file.exists()
        assert log_file.with_name("cf-ddns.log.1").exists()

    reset_logger()


if __name__ == "__main__":
    main()
