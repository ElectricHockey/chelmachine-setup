const config = global.config;
const ObjectId = require('mongodb').ObjectId;
const util = require('./util');
const users = require('./users');

const admin_accept_trade = async function(client, _id) {
    const offer = await client.db(config.db).collection('trade_offers').findOne({_id});
    const author_players = offer.author_players.filter((v,i,a)=>a.indexOf(v)===i);
    const offer_players = offer.offer_players.filter((v,i,a)=>a.indexOf(v)===i);
    const author_team = await client.db(config.db).collection('teams').findOne({_id:offer.author_team});
    const offer_team = await client.db(config.db).collection('teams').findOne({_id:offer.offer_team});
    author_team.roster = author_team.roster.filter((p)=>!author_players.includes(p)).concat(offer_players);
    offer_team.roster = offer_team.roster.filter((p)=>!offer_players.includes(p)).concat(author_players);
    await client.db(config.db).collection('teams').updateOne({_id:author_team._id}, {$set:{roster:author_team.roster}});
    await client.db(config.db).collection('teams').updateOne({_id:offer_team._id}, {$set:{roster:offer_team.roster}});
    await client.db(config.db).collection('trade_offers').deleteOne({_id});
}

const admin_deny_trade = async function(client, _id) {
    await client.db(config.db).collection('trade_offers').deleteOne({_id});
}

const accepted_trades = async function(client) {
    const c = client.db(config.db).collection('trade_offers').find({accepted: true});
    const at = [];
    for await (const d of c) { at.push(d); }
    return at.length > 0 ? at : null;
}

const accepted_trade_offer = async function(client, offer_team) {
    offer_team = new ObjectId(offer_team);
    return await client.db(config.db).collection('trade_offers').findOne({offer_team, accepted: true});
}

const active_trade_offer = async function(client, author_team) {
    author_team = new ObjectId(author_team);
    return await client.db(config.db).collection('trade_offers').findOne({author_team, expires: { $gte: new Date()} });
}

const received_trade_offers = async function(client, offer_team) {
    offer_team = new ObjectId(offer_team);
    const offers = await client.db(config.db).collection('trade_offers').find({offer_team, expires: { $gte: new Date()} }).toArray();
    if (offers.length > 0) {
        const usernames = {};
        offers.forEach((offer) => {
            offer.offer_players.forEach((p)=>usernames[p]=1);
            offer.author_players.forEach((p)=>usernames[p]=1);
        });
        const trade_users = await client.db(config.db).collection('users')
            .find(util.mongo_or_array('auth.username',Object.keys(usernames))).toArray();
        await users.add_members_to_users(client, trade_users);
        offers.forEach((offer) =>offer.users = trade_users);
        return offers;
    }
}

const submit_trade_offer = async function(client, trade_offer) {
    const expires = new Date(new Date().getTime() + (24*60*60*1000));
    await client.db(config.db).collection('trade_offers').insertOne({...trade_offer,expires});
}

const accept_trade_offer = async function(client, _id) {
    await client.db(config.db).collection('trade_offers').updateOne({_id}, {$set:{accepted: true}});
}

const reject_trade_offer = async function(client, _id) {
    await client.db(config.db).collection('trade_offers').deleteOne({_id});
}

module.exports = {
    admin_accept_trade,
    admin_deny_trade,
    accepted_trades,
    accepted_trade_offer,
    accept_trade_offer,
    active_trade_offer,
    received_trade_offers,
    reject_trade_offer,
    submit_trade_offer
}
