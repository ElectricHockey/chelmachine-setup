const teams = require('./teams');
const discord = require('./discord');
const util = require('./util');
const config = global.config;
const ObjectId = require('mongodb').ObjectId;
const seasons = require('./seasons');

const get_user_collection = function(client) {
    return client.db(config.db).collection("users");
}

const add_members_to_users = async function(client, users) {
    const user_ids = users.map((u)=>u.user_id);
    const members = await client.db(config.db).collection('guild_members').find(util.mongo_or_array('userId',user_ids)).toArray();
    const members_map = {};
    members.forEach((m)=>members_map[m.userId]=m);
    users.forEach((user) => {
        user.membership = members_map[user.user_id];
    });
}

const all_users = async function(client, all_seasons) {
    let filter = {};
    if (!all_seasons) {
        const season_id = await seasons.current_season_id(client);
        filter = {'application.season_id':season_id};
    }
    const users = (await client.db(config.db).collection('users').find(filter).toArray())
        .sort((a,b)=>a.auth.username.toLowerCase().localeCompare(b.auth.username.toLowerCase()));
    await add_members_to_users(client, users);
    return users;
}

const eligible_owners = async function(client, req_team_id) {
    if (req_team_id) {
        const req_team = await client.db(config.db).collection('teams').findOne({_id:new ObjectId(req_team_id)});
        if (req_team.roster) {
            const eligible_users = req_team.roster;
            const users = await client.db(config.db).collection('users').find(util.mongo_or_array('auth.username',eligible_users)).toArray();
            await add_members_to_users(client, users);
            const valid_users = users.filter((u)=>u.membership);
            return valid_users;
        }
    }
    return [];
}

const eligible_users = async function(client, season_id) {
    const current_teams = await teams.season_teams(client, season_id);
    const username_map = {};
    current_teams.forEach((team) => {
        if (team.roster) {
            team.roster.forEach((u)=>username_map[u]=1);
        }
    });
    const usernames = Object.keys(username_map);
    const all_users = await client.db(config.db).collection('users').find({'auth.username':{$nin:usernames}}).toArray();
    const users = all_users.sort((a,b)=> {
        const get_name = (x) => {return x.membership?x.membership.displayName:x.auth.username};
        return get_name(a).toLowerCase().localeCompare(get_name(b).toLowerCase());
    });
    await add_members_to_users(client, users);
    return users;
}

const lineup_available_users = async function(client, team, date) {
    const avail = {};
    if (team.roster) {
        const c = client.db(config.db).collection('users').find(util.mongo_or_array('auth.username',team.roster));
        for await (const user of c) {
            if (user.availability) {
                const day = config.availability.days[date.getDay()];
                const hours24 = date.getHours();
                const hours12 = hours24 % 12;
                const merid = (hours24 === hours12) ? 'AM' : 'PM';
                const tz = 'EST';
                const timelabel = `${hours12}:${date.getMinutes()} ${merid} ${tz}`;
                const slot = `${day}.${timelabel}`;
                avail[user.auth.username] = user.availability[slot];
            } else {
                avail[user.auth.username] = false;
            }
        }
    }
    return Object.keys(avail).length ? avail : null;
}

const free_agent = async function(client, username) {
    const team = await client.db(config.db).collection('teams').findOne({roster:{$in:[username]}});
    return team ? false : true;
}

const get_record = async function(client, user_id) {
    const collection = get_user_collection(client);
    return await collection.findOne({user_id});
}

const loggedin = async function(client, profile) {
    const collection = get_user_collection(client);
    const user_id = profile.id;
    const user = await get_record(client, user_id);
    if (user === null) {
        await collection.insertOne({
            user_id,
            auth: profile
        });
        await discord.send_welcome_message(client, user_id);
    } else if (user.banned) {
        return false;
    }
    return true;
}

const logout_user = async function(client, user_id) {
    const sessions = await client.db(config.db).collection('sessions').find({}).toArray();
    const logouts = [];
    sessions.forEach((s) => {
        const session = JSON.parse(s.session);
        try {
            if (session.passport.user.id === user_id) {
                logouts.push(s._id);
            }
        } catch(e) {} // eslint-disable-line no-empty
    });
    await client.db(config.db).collection('sessions').deleteMany({_id:{$in:logouts}});
}

const update_record = async function(client, user_id, profile, logout) {
    const collection = get_user_collection(client);
    await collection.updateOne({user_id}, {$set: {...profile}});
    if (logout) {
        await logout_user(client, user_id);
    }
}

const are_gamertags_unique = async function(client, user_id, gamertags) {
    const ref_user = await client.db(config.db).collection('users').findOne({user_id});
    const searches = [];
    Object.keys(gamertags).forEach((clientPlatform) => {const o = {};o[`gamertags.${clientPlatform}`] = gamertags[clientPlatform];searches.push(o);});
    if (searches.length > 0) {
        const users = await client.db(config.db).collection('users').find({$or:searches}).toArray();
        for (let u = 0;u < users.length;u++) {
            const user = users[u];
            if (!user._id.equals(ref_user._id)) {
                return false;
            }
        }
    }
    return true;
}

const get_usernames = async function(client, usernames) {
    if (usernames && usernames.length > 0) {
        const users = await client.db(config.db).collection('users').find(util.mongo_or_array('auth.username',usernames)).toArray();
        await add_members_to_users(client, users);
        return users;
    }
}

const get_username = async function(client, username) {
    return await client.db(config.db).collection('users').findOne({'auth.username':username});
}

const sanitize = function(user) {
    if (user) {
        return {
            playername: user.playername,
            user_id: user.user_id,
            auth: {
                avatar: user.auth.avatar,
                username: user.auth.username
            },
            membership: user.membership
        };
    }
}

module.exports = {
    are_gamertags_unique,
    add_members_to_users,
    all_users,
    eligible_owners,
    eligible_users,
    free_agent,
    get_usernames,
    get_username,
    get_record,
    logout_user,
    lineup_available_users,
    update_record,
    loggedin,
    sanitize
}
