
const users = require('./users');
const discord = require('./discord');
const config = global.config;
const ObjectId = require('mongodb').ObjectId;
const util = require('./util');

const accept_offer = async function(client, _id, user_id) {
    const offer_sheet = await client.db(config.db).collection('fa_offers').findOne({_id});
    if (offer_sheet && offer_sheet.user_id === user_id) {
        const team = await client.db(config.db).collection('teams').findOne({_id:offer_sheet.team});
        const user = await users.get_record(client, user_id);
        await discord.player_signed_to_team(client, user, team);
        await client.db(config.db).collection('teams').updateOne({_id:team._id},{$addToSet:{roster:user.auth.username}});
        await client.db(config.db).collection('fa_offers').deleteMany({user_id});
        await discord.team_fa_offer_accepted(client, offer_sheet);
        return true;
    }
    return false;
}

const pending_free_agents = async function(client, filter) {
    const offers = await client.db(config.db).collection('fa_offers').find(filter).sort({expires:1}).toArray();
    if (offers.length > 0) {
        const user_ids = {};
        offers.forEach((offer) => {
            user_ids[offer.user_id] = 1;
        });
        const ufilter = util.mongo_or_array('user_id',Object.keys(user_ids));
        const fa_users = await client.db(config.db).collection('users').find(ufilter).sort({'auth.username':-1}).toArray();
        await users.add_members_to_users(client, fa_users);
        fa_users.forEach((user) => {
            offers.forEach((offer) => {
                if (offer.user_id == user.user_id) {
                    offer.user = user;
                }
            });
        });
        return offers;
    }
    return null;
}

const pending_free_agents_all = async (client) => await pending_free_agents(client, {expires: { $gte: new Date() }});
const pending_free_agents_team = async (client, team) => await pending_free_agents(client, {team:new ObjectId(team), expires: { $gte: new Date() }});
const pending_free_agent_offers = async (client, user_id) => await pending_free_agents(client, {user_id, expires: { $gte: new Date() }});

const submit_tender = async (client, team, user_id) => {
    const expires = new Date(new Date().getTime() + (24*60*60*1000));
    const offer_sheet = {user_id,team,expires};
    await client.db(config.db).collection('fa_offers').insertOne(offer_sheet);
    await discord.send_fa_offer_message(client, offer_sheet);
}

module.exports = {
    accept_offer,
    pending_free_agents_all,
    pending_free_agents_team,
    pending_free_agent_offers,
    submit_tender,
}