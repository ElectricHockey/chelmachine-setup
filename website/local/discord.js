const util = require('./util');
const config = global.config;
const ObjectId = require('mongodb').ObjectId;

const dev_discord_id = ''; // twgage

const Role = (user_id, role, reason) => { 
    if (global.dev_mode) { user_id = dev_discord_id; }
    return {user_id,role,reason}; 
};
const Message = (user_id, data) => { 
    if (global.dev_mode) { user_id = dev_discord_id; }
    return {user_id, data}; 
};
const Transaction = (team, user, transaction_type) => {
    const user_id = user.user_id;
    const team_id = team._id;
    return {user_id,team_id,transaction_type};
};
const FrontOfficeChange = (team) => {
    return {
        team_id: team._id,
        ownership: team.ownership,
        transaction_type: 'fo_change'
    };
};
const TradeApproved = (trade_offer) => {
    return {
        trade_offer,
        transaction_type: 'trade'
    };
};

const discord_process = async function(client, args) {
    if (config.discord_client_token) {
        const insert_time = new Date();
        await client.db(config.db).collection('discord').insertOne({...args,insert_time});
    }

    // user mailbox posting
    if (args.messages) {
        for (let m = 0;m < args.messages.length;m++) {
            const message = args.messages[m];
            message.time = new Date();
            await client.db(config.db).collection('messages').insertOne(message);
        }
    }
}

const profile_positions_changed = async function(client, user_id, positions) {
    if (config.roles && Object.keys(config.roles).length > 0) {
        const args = {};
        const no_pos = ['center','left_wing','right_wing','left_defense','right_defense','goalie'].filter((p)=>!positions.includes(p));
        if (no_pos.length > 0) {
            args.remove_roles = no_pos.map((p) => Role(user_id,config.roles[p],'Website Profile Changed')).filter((r)=>r.role);
        }
        if (positions.length > 0) {
            args.add_roles = positions.map((p) => Role(user_id,config.roles[p],'Website Profile Changed')).filter((r)=>r.role);
        }
        if (Object.keys(args).length > 0) {
            await discord_process(client, args);
        }
    }
}

const application_submitted = async function(client, user_id, application) {
    await profile_positions_changed(client, user_id, application.positions);
    if (config.roles) {
        await discord_process(client, {
            remove_roles:[Role(user_id,config.roles.new_to_server,'Website Application Submitted')],
            add_roles:[Role(user_id,config.roles.free_agent,'Website Application Submitted')]
        });
    }
}

const player_signed_to_team = async function(client, user, team) {
    if (config.discord_client_token) {
        const args = {
            remove_roles: [Role(user.auth.id, config.roles.free_agent, 'Website Player Signed To Team')],
            add_roles: [Role(user.auth.id, team.discord_role, 'Website Player Signed To Team')],
            transactions: [Transaction(team, user, 'fa_signing')],
        };
        await discord_process(client, args);
    }
}

const player_set_fo_role = async function(client, user_id, role) {
    if (config.discord_client_token) {
        const roles = config.roles.front_office;
        const args = {add_roles:[],remove_roles:[]};
        if (roles) {
            // remove existing FO roles
            Object.values(roles).forEach((r) => {
                if (r) {
                    args.remove_roles.push(Role(user_id,r,'Website FO Role Removed'));
                }
            });

            // add new role
            if (role in roles) {
                args.add_roles.push(Role(user_id,roles[role],'Website FO Role Added'));
            }

            await discord_process(client, args);
        }
    }
}

const send_admin_message = async (client, message) => {
    const admin_users = await client.db(config.db).collection('users').find({admin:true}).toArray();
    const messages = admin_users.map((u) => Message(u.user_id, message));
    await discord_process(client, {messages});
}

const lineup_changed = async function(client, game, lineup, standby) {
    const filter = util.mongo_or_array('auth.username',Object.values(lineup).concat(standby));
    const c = client.db(config.db).collection('users').find(filter);
    let msg = 'This games lineup has been updated!\n';
    msg = `${msg}Game: ${game.away.toUpperCase()} at ${game.home.toUpperCase()}\n`;
    msg = `${msg}Date: ${util.pretty_date(game.date)}\n`;
    msg = `${msg}LINEUP:\n`;
    msg = `${msg}- Center: ${lineup['center']}\n`;
    msg = `${msg}- Left Wing: ${lineup['left_wing']}\n`;
    msg = `${msg}- Right Wing: ${lineup['right_wing']}\n`;
    msg = `${msg}- Left Defense: ${lineup['left_defense']}\n`;
    msg = `${msg}- Right Defense: ${lineup['right_defense']}\n`;
    msg = `${msg}- Goalie: ${lineup['goalie']}\n`;
    msg = `${msg}STANDBY:\n`;
    standby.forEach((p) => msg = `${msg}- ${p}\n`);
    const messages = [];
    for await (const u of c) {
        messages.push(Message(u.user_id, msg));
    }
    await discord_process(client, {messages});
}

const send_fa_offer_message = async function(client, offer_sheet) {
    const team = await client.db(config.db).collection('teams').findOne({_id:offer_sheet.team});
    const msg = `You have received an offer sheet from the ${team.team_name}! Go to ${config.url.offer} to accept or reject this offer. This offer expires in 24 Hours.`;
    await discord_process(client, {messages:[Message(offer_sheet.user_id, msg)]});
}

const on_players_released = async function(client, team, release_players) {
    if (release_players.length == 0) {
        return;
    }

    const args = {messages:[],add_roles:[],remove_roles:[],transactions:[]};
    for (let i = 0;i < release_players.length;i++) {
        const username = release_players[i];
        const user = await client.db(config.db).collection('users').findOne({'auth.username':username});
        if (user) {
            if (team.discord_role) {
                args.remove_roles.push(Role(user.user_id, team.discord_role, 'Website Released From Team'));
            }
            args.add_roles.push(Role(user.user_id, config.roles.free_agent, 'Website Released From Team'));
            args.messages.push(Message(user.user_id, `You have been released from ${team.team_name} and are now a Free Agent.`));
            args.transactions.push(Transaction(team, user, 'release'));
        }
    }

    await discord_process(client, args);
}

const send_welcome_message = async function(client, user_id) {
    const msg = `Welcome to the ${config.name}! Now that you have created an account, make sure you submit your player application at ${config.url.profile}`;
    await discord_process(client, {messages:[Message(user_id, msg)]});
}

const submit_trade_offer = async function(client, trade_offer) {
    const teams = await client.db(config.db).collection('teams').find(util.mongo_or_array('_id',[trade_offer.author_team, trade_offer.offer_team])).toArray();
    const author_team = teams.find((t)=>t._id.equals(trade_offer.author_team));
    const notify_team = teams.find((t)=>t._id.equals(trade_offer.offer_team));
    if (notify_team.ownership) {
        let msg = `${author_team.team_name} has sent the ${notify_team.team_name} a trade offer. Go to ${config.url.frontoffice_trade} to accept/reject.`;
        msg = `${msg}\nTRADE TERMS:`;
        msg = `${msg}\n${notify_team.team_name} RECEIVES:`;
        trade_offer.author_players.forEach((p) => msg = `${msg}\n- ${p}`);
        msg = `${msg}\n${author_team.team_name} RECEIVES:`;
        trade_offer.offer_players.forEach((p) => msg = `${msg}\n- ${p}`);
        const messages = [];
        Object.values(notify_team.ownership).forEach((owner) => {
            messages.push(Message(owner.user_id, msg));
        });
        await discord_process(client, {messages});
    }
}

const team_trade_block_updated = async function(client, team, other_teams) {
    const messages = [];
    let msg = `${team.team_name} has updated their trade block!`;
    if (team.trade_block && team.trade_block.length) {
        msg = `${msg} Their trade block is now:\n`;
        team.trade_block.forEach((p) => msg = `${msg}- ${p}\n`);
    } else {
        msg = `${msg} No players are on their trade block.`;
    }
    other_teams.forEach((t) => {
        if (t.ownership) {
            Object.values(t.ownership).forEach((owner) =>messages.push(Message(owner.user_id, msg)));
        }
    });
    await discord_process(client, {messages});
}

const send_team_ownership_message = async function(client, team, text) {
    const messages = [];
    for (const [key, value] of Object.entries(team.ownership)) { // eslint-disable-line no-unused-vars
        messages.push(Message(value.user_id, text));
    }
    await discord_process(client, {messages});
}

const team_fa_offer_accepted = async function(client, offer_sheet) {
    const team = await client.db(config.db).collection('teams').findOne({_id:offer_sheet.team});
    const player = await client.db(config.db).collection('users').findOne({user_id:offer_sheet.user_id});
    const text = `${player.auth.username} has accepted the term sheet to join the ${team.team_name}!`;
    await send_team_ownership_message(client, team, text);
}

const trade_offer_message = async function(client, _id, accepted) {
    const trade_offer = await client.db(config.db).collection('trade_offers').findOne({_id});
    if (trade_offer) {
        const team_ids = [trade_offer.author_team,trade_offer.offer_team].map((x)=>new ObjectId(x));
        const teams = await client.db(config.db).collection('teams').find(util.mongo_or_array('_id',team_ids)).toArray();
        const author_team = teams.find((t) => t._id.equals(trade_offer.author_team));
        const offer_team = teams.find((t) => t._id.equals(trade_offer.offer_team));
        const text = accepted ? `Your trade offer to the ${offer_team.team_name} has been accepted and sent to Transactions for review!` : 
            `Your trade offer to the ${offer_team.team_name} has been rejected.`;
        await send_team_ownership_message(client, author_team, text);
    }
}

const accept_trade_offer = async (client, offer_id) => await trade_offer_message(client, offer_id, true);
const reject_trade_offer = async (client, offer_id) => await trade_offer_message(client, offer_id, false);

const admin_trade_message = async function(client, _id, accepted) {
    const trade_offer = await client.db(config.db).collection('trade_offers').findOne({_id});
    const teams = await client.db(config.db).collection('teams').find(util.mongo_or_array('_id',[trade_offer.author_team,trade_offer.offer_team])).toArray();
    const author_team = teams.find((t) => t._id.equals(trade_offer.author_team));
    const offer_team = teams.find((t) => t._id.equals(trade_offer.offer_team));
    if (accepted) {
        const args = {add_roles:[],remove_roles:[],transactions:[]};
        const users = await client.db(config.db).collection('users').find(util.mongo_or_array('auth.username',trade_offer.offer_players.concat(trade_offer.author_players))).toArray();
        users.forEach((user) => {
            if (trade_offer.author_players.includes(user.auth.username)) {
                args.remove_roles.push(Role(user.auth.id, author_team.discord_role, 'Website Trade Approved'));
                args.add_roles.push(Role(user.auth.id, offer_team.discord_role, 'Website Trade Approved'));
                //author_user_ids.push(user.auth.id);
            } else if (trade_offer.offer_players.includes(user.auth.username)) {
                args.remove_roles.push(Role(user.auth.id, offer_team.discord_role, 'Website Trade Approved'));
                args.add_roles.push(Role(user.auth.id, author_team.discord_role, 'Website Trade Approved'));
            }
        });
        args.transactions.push(TradeApproved(trade_offer));
        await discord_process(client, args);
    }
    const status = accepted ? 'ACCEPTED' : 'DENIED';
    const text = `The trade between ${author_team.team_name} and ${offer_team.team_name} has been ${status} by the Transactions team and is now finalized.`;
    await send_team_ownership_message(client, author_team, text);
    await send_team_ownership_message(client, offer_team, text);
}

const admin_accept_trade = async (client, offer_id) => await admin_trade_message(client, offer_id, true);
const admin_deny_trade = async (client, offer_id) => await admin_trade_message(client, offer_id, false);

const team_jersey_updated = async (client, _id) => {
    const team = await client.db(config.db).collection('teams').findOne({_id});
    if (team) {
        const message = `The ${team.team_name} have uploaded new jerseys. You can review them on the admin TEAMS page`;
        await send_admin_message(client, message);
    }
}

const club_ownership_changed = async (client, team_id) => {
    const team = await client.db(config.db).collection('teams').findOne({_id:team_id});
    if (team) {
        await discord_process(client, {transactions:[FrontOfficeChange(team)]});
    }
}

module.exports = {
    application_submitted,
    lineup_changed,
    profile_positions_changed,
    send_fa_offer_message,
    on_players_released,
    send_welcome_message,
    submit_trade_offer,
    team_trade_block_updated,
    team_fa_offer_accepted,
    accept_trade_offer,
    reject_trade_offer,
    admin_accept_trade,
    admin_deny_trade,
    player_signed_to_team,
    player_set_fo_role,
    team_jersey_updated,
    club_ownership_changed,
}
