const seasons = require('./seasons');
const discord = require('./discord');
const config = global.config;
const ObjectId = require('mongodb').ObjectId;

const change_club_ownership = async function(client, team, owner_id, gm_id, agm_id, agm2_id) {
    const user_filter = {$or:[{user_id:owner_id},{user_id:gm_id},{user_id:agm_id},{user_id:agm2_id}]};
    const users = await client.db(config.db).collection('users').find(user_filter).toArray();
    const roster = team.roster ? team.roster : [];
    const ownership = team.ownership ? team.ownership : {};
    const old_owners = Object.values(ownership).map((o) => o.user_id);
    const add_to_roster = async (user) => {
        if (roster.indexOf(user.auth.username) === -1) {
            roster.push(user.auth.username);
            await discord.player_signed_to_team(client, user, team);
        }
    };
    for (let u = 0;u < users.length;u++) {
        const user = users[u];
        if (user.user_id === owner_id) {
            ownership.owner = { discordname: user.auth.username, user_id: user.user_id };
            await add_to_roster(user);
        }
        if (user.user_id === gm_id) {
            ownership.gm = { discordname: user.auth.username, user_id: user.user_id };
            await add_to_roster(user);
        }
        if (user.user_id === agm_id) {
            ownership.agm = { discordname: user.auth.username, user_id: user.user_id };
            await add_to_roster(user);
        }
        if (user.user_id === agm2_id) {
            ownership.agm2 = { discordname: user.auth.username, user_id: user.user_id };
            await add_to_roster(user);
        }
    }
    if (owner_id === null) {
        delete ownership.owner;
    }
    if (gm_id === null) {
        delete ownership.gm;
    }
    if (agm_id === null) {
        delete ownership.agm;
    }
    if (agm2_id === null) {
        delete ownership.agm2;
    }
    const new_owners = Object.values(ownership).map((o) => o.user_id);
    const remove_owners = old_owners.filter((o) => !new_owners.includes(o));
    for (let r = 0;r < remove_owners.length;r++) {
        await discord.player_set_fo_role(client, remove_owners[r], null);
    }
    const roles = Object.keys(ownership);
    for (let o = 0;o < roles.length;o++) {
        await discord.player_set_fo_role(client, ownership[roles[o]].user_id, roles[o]);
    }
    await client.db(config.db).collection('teams').updateOne({_id:team._id}, {$set: {ownership, roster}});
    await discord.club_ownership_changed(client, team._id);

    if (!global.dev_mode) {
        // invalidate web sessions of everyone who was labeled as team owner to force relogin
        const coll_sessions = client.db(config.db).collection('sessions');
        const c = coll_sessions.find({});
        const remove_sessions = [];
        for await (const session of c) {
            const sdata = JSON.parse(session.session);
            if (sdata.front_office_teams) {
                if (sdata.front_office_teams.find((t)=>team._id.equals(t._id))) {
                    remove_sessions.push(session._id);
                }
            }
        }
        for (let i = 0;i < remove_sessions.length;i++) {
            const _id = remove_sessions[i];
            await coll_sessions.deleteOne({_id});
        }
    }
};

const season_teams = async function(client, season_id) {
    const teams = await client.db(config.db).collection("teams").find({season_id}).sort({team_name: 1}).toArray();
    return teams;
}

const current_teams = async function(client) {
    return await season_teams(client, await seasons.current_season_id(client));
}

const teams_by_id = async function(client, season_id, teams) {
    const collection = client.db(config.db).collection("teams");
    const filter = { season_id, team_id: { $in: [ teams[0], teams[1] ] } };
    const result = await collection.find(filter).toArray();
    return result;
}

const team_by_id = async function(client, season_id, team_id) {
    const team = await client.db(config.db).collection("teams").findOne({season_id,team_id});
    return team;
}

const team_by_rostered = async function(client, playername) {
    return await client.db(config.db).collection('teams').findOne({roster:{$in:[playername]}});
}

const team_lookup = async function(client, req_id) {
    if (req_id) {
        try {
            const _id = new ObjectId(req_id);
            return await client.db(config.db).collection('teams').findOne({_id});
        } catch(e) {
            return undefined;
        }
    }
}

const teams_owned_by_user = async function(client, user) {
    const teams = (await client.db(config.db).collection('teams').find({ownership:{$exists:true}})
        .sort({season_id: -1}).toArray())
        .filter((t)=>Object.values(t.ownership).find((o)=>o.user_id == user.user_id));
    return teams;
}

module.exports = {
    change_club_ownership,
    current_teams,
    season_teams,
    teams_by_id,
    team_by_id,
    team_by_rostered,
    team_lookup,
    teams_owned_by_user
};