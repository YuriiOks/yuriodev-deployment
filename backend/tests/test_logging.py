"""configure_logging(): LOG_LEVEL applied, JSON line shape, console format, uvicorn wiring."""

import json
import logging

from src.core.logging import configure_logging, reset_request_id, set_request_id


def ours(logger):
    return [h for h in logger.handlers if h.get_name() == "yuriodev"]


def test_log_level_is_applied(make_settings):
    configure_logging(make_settings(log_level="DEBUG"))

    root = logging.getLogger()
    assert root.level == logging.DEBUG
    assert ours(root)[0].level == logging.DEBUG


def test_log_level_from_the_environment_is_applied(clean_env):
    from src.core.config import Settings

    clean_env.setenv("LOG_LEVEL", "warning")
    configure_logging(Settings(_env_file=None))

    assert logging.getLogger().level == logging.WARNING


def test_configure_twice_keeps_one_handler(make_settings):
    configure_logging(make_settings())
    configure_logging(make_settings())

    assert len(ours(logging.getLogger())) == 1


def test_json_line_shape(make_settings, capsys):
    configure_logging(make_settings(log_format="json"))
    capsys.readouterr()

    logging.getLogger("yuriodev.test").info(
        "hello %s", "world", extra={"event": "test.event", "color_message": "\x1b[36mhello"}
    )
    token = set_request_id("req-12345678")
    try:
        logging.getLogger("yuriodev.test").warning("inside a request")
    finally:
        reset_request_id(token)

    first, second = (json.loads(line) for line in capsys.readouterr().out.splitlines())
    assert list(first)[:5] == ["timestamp", "level", "logger", "message", "request_id"]
    assert first["timestamp"].endswith("Z")
    assert first["level"] == "INFO"
    assert first["logger"] == "yuriodev.test"
    assert first["message"] == "hello world"
    assert first["request_id"] is None
    assert first["event"] == "test.event"
    assert "color_message" not in first
    assert second["request_id"] == "req-12345678"


def test_json_line_carries_the_traceback_in_one_line(make_settings, capsys):
    configure_logging(make_settings(log_format="json"))
    capsys.readouterr()

    try:
        raise ValueError("kaput")
    except ValueError:
        logging.getLogger("yuriodev.test").exception("failed")

    lines = capsys.readouterr().out.splitlines()
    assert len(lines) == 1
    assert "ValueError: kaput" in json.loads(lines[0])["exc_info"]


def test_console_format(make_settings, capsys):
    configure_logging(make_settings(log_format="console"))
    capsys.readouterr()
    logger = logging.getLogger("yuriodev.test")

    logger.info("plain")
    token = set_request_id("req-12345678")
    try:
        logger.info("with fields", extra={"event": "test.event"})
    finally:
        reset_request_id(token)
    try:
        raise ValueError("kaput")
    except ValueError:
        logger.exception("failed", extra={"event": "test.fail"})

    out = capsys.readouterr().out
    assert "INFO     yuriodev.test: plain\n" in out
    assert "with fields [request_id=req-12345678 event=test.event]" in out
    assert "failed [event=test.fail]\nTraceback" in out
    assert not out.lstrip().startswith("{")


def test_uvicorn_logs_go_through_our_handler_and_its_access_log_is_off(make_settings):
    for name in ("uvicorn", "uvicorn.access"):
        logging.getLogger(name).addHandler(logging.StreamHandler())
        logging.getLogger(name).propagate = False

    configure_logging(make_settings())

    assert logging.getLogger("uvicorn").handlers == []
    assert logging.getLogger("uvicorn").propagate is True
    assert logging.getLogger("uvicorn.access").handlers == []
    assert logging.getLogger("uvicorn.access").propagate is False


def test_http_client_loggers_stay_at_warning(make_settings):
    configure_logging(make_settings(log_level="DEBUG"))

    assert logging.getLogger("httpx").level == logging.WARNING
    assert logging.getLogger("httpcore").level == logging.WARNING
