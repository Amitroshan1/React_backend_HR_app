"""Import side-effect: ensure after_commit hooks are registered."""

from .publisher import register_session_hooks

register_session_hooks()
