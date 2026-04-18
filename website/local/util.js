const { DateTime } = require('luxon');

const array_unique = function(a) {
    return a.filter((v, i, arr) => arr.indexOf(v) === i);
}

const assert = function(x) {
    if (!(x)) {
        throw new Error(`ASSERTION FAILED WITH VALUE ${x}`);
    }
}

const coerce = function(v, c) {
    if (v === undefined || v === null) {
        return c;
    } else {
        return v;
    }
}

const coerce_float = function(v) {
    if (v === undefined || v === null) {
        return 0;
    } else if (typeof v === 'string' || v instanceof String) {
        return parseFloat(v);
    } else if (typeof v === 'number') {
        return v;
    } else {
        throw new Error(`unknown type to coerce to float: ${typeof v}: ${v}`);
    }
}

const coerce_int = function(v) {
    let r = 0;
    if (v === undefined || v === null) {
        r = 0;
    } else if (typeof v === 'string' || v instanceof String) {
        r = parseInt(v);
        if (isNaN(r)) {
            r = 0;
        }
    } else if (typeof v === 'number') {
        if (isNaN(v)) {
            return 0;
        } else {
            r = Math.floor(v);
        }
    } else {
        throw new Error(`unknown type to coerce to int: ${typeof v}: ${v}`);
    }
    if (isNaN(r)) {
        throw new Error("NAN");
    }
    return r;
}

const date_add_hours = (date, hours) => new Date(date.getTime() + (1000*60*60*hours));
const date_add_days = (date, days) => new Date(date.getTime() + (1000*60*60*24*days));

const pretty_date = function (date, hide_time) {
    const dt = DateTime.fromJSDate(date, { zone: 'America/New_York' });
    return hide_time ?
        dt.toLocaleString({ year: 'numeric', weekday: 'short', month: 'short', day: '2-digit'}) :
        `${dt.toLocaleString({ year: 'numeric', weekday: 'short', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })} EST`;
}

const pretty_time = function (date) {
    const dt = DateTime.fromJSDate(date, { zone: 'America/New_York' });
    return `${dt.toLocaleString({ hour: '2-digit', minute: '2-digit' })} EST`;
}

const mongo_or_array = function(field, arr) {
    const out = [];
    arr.forEach((val) => {const o={};o[field]=val;out.push(o)});
    if (out.length > 0) {
        return {$or:out};
    } else {
        return {};
    }
}

const compute_gaa = function(goals_allowed, toi_seconds) {
    return coerce_int(goals_allowed) * 60 / (toi_seconds / 60);
}

const get_last_sunday = (date) => {
    const t = new Date(date);
    t.setDate(t.getDate()-t.getDay());
    return t;
}

const is_valid_url = (url) => {
    var urlPattern = new RegExp('^(https?:\\/\\/)?'+ // validate protocol
        '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|'+ // validate domain name
        '((\\d{1,3}\\.){3}\\d{1,3}))'+ // validate OR ip (v4) address
        '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*'+ // validate port and path
        '(\\?[;&a-z\\d%_.~+=-]*)?'+ // validate query string
        '(\\#[-a-z\\d_]*)?$','i'); // validate fragment locator
	return !!urlPattern.test(url);
}

const date_from_seconds = (str_seconds) => {
    const dt = new Date(1970, 0, 1);
    dt.setSeconds(coerce_int(str_seconds));
    return dt;
}

const compare_strings = (a, b) => {
    return a.toLowerCase().localeCompare(b.toLowerCase());
};

module.exports = {
    array_unique,
    assert,
    coerce,
    coerce_float,
    coerce_int,
    compare_strings,
    compute_gaa,
    date_add_days,
    date_add_hours,
    get_last_sunday,
    pretty_date,
    pretty_time,
    mongo_or_array,
    is_valid_url,
    date_from_seconds
}
