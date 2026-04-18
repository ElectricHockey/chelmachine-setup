const package_json = require('../package.json');
const util = require('./util');
const fa = require('./fa');
const messages = require('./messages');
const config = global.config;

const staff_role = (user,truth) => (user.stats === truth || user.transactions === truth || user.disciplinary === truth);
const session_admin = (session) => (session.admin === true || staff_role(session, true));
const session_team_owner = (session) => (session.front_office_teams&&session.front_office_teams.length > 0);
const user_admin = (user) => (user.admin === true || staff_role(user, 'on'));

const get = async function(client, req) {
    return {
        config,
        global,
        title: config.name,
        url_title: config.label,
        embed_description: config.default_embed_description,
        version: package_json.version,
        params: req.params,
        session: req.session,
        query: req.query,
        user: req.user,
        has_unread_messages: req.user ? await messages.has_unread_messages(client, req.user.id) : false,
        pending_free_agent_offers: req.user ? await fa.pending_free_agent_offers(client, req.user.id) : false,
        pretty_date: util.pretty_date,
        pretty_time: util.pretty_time,
        is_valid_url: util.is_valid_url,
        pretty_gaa: function(gaa) {
            if (typeof gaa === 'number') {
              if (isNaN(gaa)) { return '-'; }
              return `${gaa.toFixed(2)}`;
            } else {
              return `${gaa}`;
            }
        },
        pretty_owner_position: function(pos) {
          if (pos === 'owner') {
            return 'Owner';
          } else if (pos === 'gm') {
            return 'General Manager';
          } else if (pos === 'agm' || pos === 'agm2') {
            return 'Assistant General Manager';
          } else {
            return 'NA';
          }
        },
        pretty_percent: function(pct) {
            if (typeof pct === 'number') {
              if (isNaN(pct)) { return '-'; }
              return `${pct.toFixed(3)}%`;
            } else {
              return `${pct}%`;
            }
        },
        pretty_plusminus: function(skplusmin) {
          var sknum = util.coerce_int(skplusmin);
          if (sknum < 0) {
            return sknum;
          } else {
            return `+${sknum}`;
          }
        },
        seconds_to_walltime: function(time) {
            const minutes = Math.floor(time / 60);
            const seconds = time - minutes * 60;
            function str_pad_left(string, pad, length) {
                return (new Array(length + 1).join(pad) + string).slice(-length);
            }
            return str_pad_left(minutes, '0', 2) + ':' + str_pad_left(seconds, '0', 2);
        },
        has_admin_access: () => session_admin(req.session),
        has_team_owner_access: () => session_team_owner(req.session),
    };
}

module.exports = {
    get,
    session_admin,
    user_admin
};
