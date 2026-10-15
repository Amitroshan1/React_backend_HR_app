"""Shared SQL helpers for list endpoints."""
import re
import unicodedata
from dataclasses import dataclass
from typing import Optional

from flask import current_app, has_app_context, has_request_context, request
from sqlalchemy.orm import Query

from . import db

LOAD_CHUNK = 1000
PER_PAGE_DEFAULT = 50
PER_PAGE_MAX = 100


def ci_equals(column, value):
    """
    Case-insensitive ``column == value``.

    With DB_CI_COLLATION on MySQL the column collation already ignores case, so the
    plain comparison is used and the column index stays usable.
    """
    text = "" if value is None else str(value)
    if _ci_collation():
        return column == text
    return db.func.lower(column) == text.lower()


def _ci_collation():
    return (
        has_app_context()
        and current_app.config.get("DB_CI_COLLATION")
        and db.engine.dialect.name == "mysql"
    )


def _load_by_ids(model, ids, options=()):
    """Rows for ``ids`` in the same order, loaded in chunks."""
    by_id = {}
    for start in range(0, len(ids), LOAD_CHUNK):
        chunk = ids[start:start + LOAD_CHUNK]
        for row in model.query.options(*options).filter(model.id.in_(chunk)):
            by_id[row.id] = row
    return [by_id[i] for i in ids if i in by_id]


def rows_sorted_by_id(query: Query, model, order_by, options=()):
    """
    Run ``query`` sorted by ``order_by``, sorting only ids, then load full rows by id.

    Tables that keep photos in JSON columns make MySQL sort whole rows, which fails
    with "Out of sort memory" (errno 1038) once photos are large.
    """
    ids = [row[0] for row in query.with_entities(model.id).order_by(*order_by).all()]
    return _load_by_ids(model, ids, options)


@dataclass(frozen=True)
class ListParams:
    """Paging, search, sort and row shape asked for by a list request."""

    page: Optional[int] = None
    per_page: int = PER_PAGE_DEFAULT
    search: str = ""
    sort: str = ""
    summary: bool = False


FULL_LIST = ListParams()


def pagination_enabled():
    return has_app_context() and bool(current_app.config.get("API_PAGINATION_V1"))


def _int_arg(name):
    try:
        return int(request.args.get(name) or "")
    except ValueError:
        return None


def list_params(search_arg="q"):
    """
    ListParams for the current request.

    With API_PAGINATION_V1 off every list option is ignored and FULL_LIST is returned,
    so endpoints answer exactly as before. Without ``page`` the whole list is returned.
    """
    if not (pagination_enabled() and has_request_context()):
        return FULL_LIST
    page = None
    if "page" in request.args:
        page = max(_int_arg("page") or 1, 1)
    per_page = _int_arg("per_page")
    if per_page is None or per_page < 1:
        per_page = PER_PAGE_DEFAULT
    return ListParams(
        page=page,
        per_page=min(per_page, PER_PAGE_MAX),
        search=(request.args.get(search_arg) or "").strip() if search_arg else "",
        sort=(request.args.get("sort") or "").strip(),
        summary=(request.args.get("fields") or "").strip().lower() == "summary",
    )


def apply_search(query: Query, columns, term):
    """Rows where any of ``columns`` contains ``term``, ignoring case."""
    if not term:
        return query
    if _ci_collation():
        matches = [col.contains(term, autoescape=True) for col in columns]
    else:
        needle = term.lower()
        matches = [db.func.lower(col).contains(needle, autoescape=True) for col in columns]
    return query.filter(db.or_(*matches))


def sort_order(raw, allowed, id_column, default):
    """
    ORDER BY for ``sort=name`` (ascending) or ``sort=-name`` (descending), with id as tie-break.

    ``allowed`` maps sort names to columns. Returns ``default`` when ``raw`` is empty and
    None when the name is not allowed.
    """
    if not raw:
        return default
    descending = raw.startswith("-")
    column = allowed.get(raw.lstrip("-"))
    if column is None:
        return None
    if descending:
        return (column.desc(), id_column.desc())
    return (column.asc(), id_column.asc())


def empty_pagination(params: ListParams):
    if params.page is None:
        return None
    return _pagination(params.page, params.per_page, 0)


def pagination_for(params: ListParams, total):
    """Pagination block for a page read with OFFSET (params.page - 1) * per_page, LIMIT per_page."""
    return _pagination(params.page, params.per_page, int(total))


def _pagination(page, per_page, total):
    pages = max(1, -(-total // per_page))
    return {
        "page": page,
        "per_page": per_page,
        "total": total,
        "pages": pages,
        "has_next": page < pages,
        "has_prev": page > 1,
    }


# Browser (ICU root) order of ASCII punctuation and symbols; all of them sort before digits and letters.
_ICU_PUNCT = "_-,;:!?.'\"()[]{}@*/\\&#%`^+<=>|~$"
_PUNCT_RANK = {c: i for i, c in enumerate(_ICU_PUNCT)}
_DIGIT_RUN = re.compile(r"\d+")
_SPACE, _PUNCT, _SYMBOL, _DIGIT, _LETTER = range(5)


def _primary(ch):
    if ch.isspace():
        return (_SPACE, 0)
    if ch in _PUNCT_RANK:
        return (_PUNCT, _PUNCT_RANK[ch])
    if ch.isdigit():
        return (_DIGIT, int(ch) if ch.isascii() else ord(ch))
    base = "".join(c for c in unicodedata.normalize("NFKD", ch) if not unicodedata.combining(c)) or ch
    if base[0].isalpha():
        return (_LETTER, base.casefold())
    return (_SYMBOL, ord(ch))


def collation_key(text, numeric=False):
    """
    Sort key approximating ``String.prototype.localeCompare`` in browsers (ICU root collation):
    case and accents only break ties, punctuation < digits < letters. With ``numeric`` digit runs
    compare by value, like ``localeCompare(b, undefined, { numeric: true })``.
    """
    text = "" if text is None else str(text)
    primary = []
    pos = 0
    while pos < len(text):
        run = _DIGIT_RUN.match(text, pos) if numeric else None
        if run and run.group().isascii():
            primary.append((_DIGIT, int(run.group())))
            pos = run.end()
            continue
        primary.append(_primary(text[pos]))
        pos += 1
    accents = tuple(
        tuple(c for c in unicodedata.normalize("NFD", ch) if unicodedata.combining(c)) for ch in text
    )
    case = tuple(c.isupper() for c in text)
    return tuple(primary), accents, case


def base_collation_key(text, numeric=False):
    """collation_key at ``sensitivity: "base"``: only the primary level counts, so ties keep input order."""
    return collation_key(text, numeric)[0]


def page_slice(items, params: ListParams = FULL_LIST):
    """(items, pagination) for a list already built in Python, same shape as list_rows."""
    if params.page is None:
        return list(items), None
    pagination = _pagination(params.page, params.per_page, len(items))
    start = (params.page - 1) * params.per_page
    return list(items[start:start + params.per_page]), pagination


def list_rows(query: Query, model, order_by, params: ListParams = FULL_LIST, options=(), sort_ids_first=True):
    """
    (rows, pagination) for a list endpoint.

    Without a page this is the whole list and pagination is None. With a page only that
    page is read, using a COUNT plus an id-only sorted LIMIT so large rows are never sorted.
    ``sort_ids_first=False`` keeps a single query for tables without large columns.
    """
    if params.page is None:
        if sort_ids_first:
            return rows_sorted_by_id(query, model, order_by, options), None
        return query.options(*options).order_by(*order_by).all(), None

    total = query.with_entities(db.func.count(model.id)).order_by(None).scalar() or 0
    pagination = _pagination(params.page, params.per_page, int(total))
    offset = (params.page - 1) * params.per_page
    if offset >= total:
        return [], pagination
    if sort_ids_first:
        ids = [
            row[0]
            for row in query.with_entities(model.id).order_by(*order_by).offset(offset).limit(params.per_page)
        ]
        return _load_by_ids(model, ids, options), pagination
    rows = query.options(*options).order_by(*order_by).offset(offset).limit(params.per_page).all()
    return rows, pagination
