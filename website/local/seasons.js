const config = global.config;
const util = require('./util');

const add_season = async function(client, label, season_id) {
    let order = 0;
    if (season_id === undefined) {
        const seasons = await client.db(config.db).collection('seasons').find({}).toArray();
        season_id = 0;
        seasons.forEach((season) => {
            if (season.season_id > season_id) {
                season_id = season.season_id;
            }
            if (season.order > order) {
                order = season.order;
            }
        });
        season_id++;
        order++;
    }
    await client.db(config.db).collection('seasons').insertOne({label,season_id,order});

    // logout all users not registered for this season
    const sessions = await client.db(config.db).collection('sessions').find().toArray();
    const user_ids = [];
    sessions.forEach((sess) => {
        const sessdata = JSON.parse(sess.session);
        user_ids.push(sessdata.passport.user.id);
    });
    const users = await client.db(config.db).collection('users').find(util.mongo_or_array('user_id',user_ids)).toArray();
    const invalid_users = [];
    users.forEach((user) => {
        if (user.application && user.application.season_id != season_id) {
            invalid_users.push(user.user_id);
        }
    });
    const del_sessions = [];
    sessions.forEach((sess) => {
        const data = JSON.parse(sess.session);
        const user_id = invalid_users.find((u)=>u==data.passport.user.id);
        if (user_id) {
            del_sessions.push(sess._id);
        }
    });
    await client.db(config.db).collection('sessions').deleteMany(util.mongo_or_array('_id',del_sessions));
}

const get_seasons = async function(client) {
    return await client.db(config.db).collection('seasons').find({}).sort({order:-1}).toArray();
}

const update_season = async function(client, season_id, label, order) {
    await client.db(config.db).collection('seasons').updateOne({season_id},{$set:{label,order}});
}

const update_seasons = async function(client, seasons) {
    for (let i = 0;i < seasons.length;i++) {
        await update_season(client, seasons[i].season_id, seasons[i].label, seasons[i].order);
    }
}

const current_season = async function(client) {
    const seasons = await client.db(config.db).collection('seasons').find({}).sort({order:-1}).limit(1).toArray();
    const season = seasons[0];
    return season;
}

const current_season_id = async function(client) {
    const season = await current_season(client);
    if (season) {
        return season.season_id;
    }
}

module.exports = {
    current_season,
    current_season_id,
    add_season,
    get_seasons,
    update_season,
    update_seasons
}
