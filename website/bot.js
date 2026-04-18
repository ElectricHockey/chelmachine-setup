const { Client, Collection, Events, GatewayIntentBits, REST, Routes } = require('discord.js');
const config = require(`./config.${process.argv[2]}.json`);
global.config = config;
global.dev_mode = (process.env.CHELMACHINE_DEV == 1) ? true : false;
const db = require('./local/db');
const { setIntervalAsync } = require('set-interval-async');
const util = require('./local/util');
const cvar = require('./local/cvar');
const cmd_team = require('./bot/cmd_team');

const bot_slash_command_version = 17; // Increment this number when you change slash commands
const discord = new Client({intents: [GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers,GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions,GatewayIntentBits.DirectMessageTyping,GatewayIntentBits.MessageContent]});

if (!global.dev_mode) {
    const on_except = async (err) => {
        console.error('Exception Occurred, Logging and Exiting');
        const client = await db.client();
        await client.db('discord_bot').collection('exceptions').insertOne({
            source: 'bot',
            message: err.message,
            stack: err.stack,
            insert_date: new Date()
        });
        await client.close();
        process.exit(1);
    };
    process.on('uncaughtException', on_except);
    process.on('unhandledRejection', on_except);
}

const get_guild = async guild_id => {
    const guild = await discord.guilds.fetch(guild_id);
    if (guild) {
        const roles = await guild.roles.fetch();
        return {guild,roles};
    }
};

const process_document_remove_roles = async (client, document, local_config) => {
    if (document.remove_roles) {
        const ginfo = await get_guild(local_config.guild_id);
        if (ginfo) {
            for (let r = 0;r < document.remove_roles.length;r++) {
                const role_def = document.remove_roles[r];
                try {
                    const member = await ginfo.guild.members.fetch(role_def.user_id);
                    if (member) {
                        const role = ginfo.roles.find((r) => r.name == role_def.role);
                        if (role) {
                            await member.roles.remove(role);
                            console.log(`Removed Role ${role.toString()} from user ${member.toString()}`);
                        }
                    }
                } catch (err) {
                    // do nothing
                }
            }
        }
    }
};

const process_document_add_roles = async (client, document, local_config) => {
    if (document.add_roles) {
        const ginfo = await get_guild(local_config.guild_id);
        if (ginfo) {
            for (let r = 0;r < document.add_roles.length;r++) {
                const role_def = document.add_roles[r];
                try {
                    const member = await ginfo.guild.members.fetch(role_def.user_id);
                    if (member) {
                        const role = ginfo.roles.find((r) => r.name == role_def.role);
                        if (role) {
                            await member.roles.add(role);
                            console.log(`Added Role ${role.toString()} to user ${member.toString()}`);
                        }
                    }
                } catch(err) {
                    // do nothing
                }
            }
        }
    }
};

const process_document_messages = async (client, document) => {
    if (document.messages) {
        for (let m = 0;m < document.messages.length;m++) {
            const message = document.messages[m];
            try {
                const user = await discord.users.fetch(message.user_id);
                if (user) {
                    await user.send(message.data);
                    console.log(`Sent Message ${message.data} to ${user.toString()}`);
                }
            } catch (err) {
                // do nothing
            }
        }
    }
};

const process_document_transactions = async (client, document, local_config) => {
    if (document.transactions) {
        const ginfo = await get_guild(local_config.guild_id);
        if (!ginfo) {
            console.error(`process_document_transactions: guild_id not valid`);
            return;
        }
        let gchannel;
        if (local_config.transactions_ledger_channel_id) {
            gchannel = await discord.channels.fetch(local_config.transactions_ledger_channel_id);
            if (!gchannel) {
                console.error('process_document_transactions: channel_id is not valid');
                return;
            }
        } else {
            return;
        }

        for (let t = 0;t < document.transactions.length;t++) {
            const tx = document.transactions[t];
            const pretty_name = (name) => name; // convert to discord @?
            const pretty_member = async (userId) => {
                const member = await client.db(local_config.db).collection('guild_members').findOne({userId});
                if (member)
                    return member.displayName;
                const user = await client.db(local_config.db).collection('users').findOne({user_id:userId});
                if (user) 
                    return user.auth.username;
                return 'Unknown';
            };
            const send_msg = async (msg) => {
                if (global.dev_mode)
                    console.log(`Sending message: ${msg}`);
                await gchannel.send(msg);
            };
            const tx_handlers = {
                fa_signing: async () => {
                    const team = await client.db(local_config.db).collection('teams').findOne({_id:tx.team_id});
                    const msg = `The ${team.team_name} have signed free agent ${await pretty_member(tx.user_id)}`;
                    await send_msg(msg);
                },
                fo_change: async () => {
                    const team_id = tx.team_id;
                    const ownership = tx.ownership;
                    const team = await client.db(local_config.db).collection('teams').findOne({_id:team_id});
                    let msg = `The ${team.team_name} have made the following front office changes:\n`;
                    const roles = {
                        owner: 'Owner',
                        gm: 'General Manager',
                        agm: 'Assistant General Manager',
                        agm2: 'Assistant General Manager'
                    };
                    Object.keys(roles).forEach((role) => {
                        if (ownership[role]) {
                            msg += `  ${roles[role]}: ${pretty_name(ownership[role].discordname)}\n`;
                        }
                    });
                    await send_msg(msg);
                },
                release: async () => {
                    const team_id = tx.team_id;
                    const team = await client.db(local_config.db).collection('teams').findOne({_id:team_id});
                    const msg = `The ${team.team_name} have released ${await pretty_member(tx.user_id)}`;
                    await send_msg(msg);
                },
                trade: async () => {
                    const trade_offer = [
                        {
                            team_id: tx.trade_offer.author_team,
                            players: tx.trade_offer.author_players,
                        },
                        {
                            team_id: tx.trade_offer.offer_team,
                            players: tx.trade_offer.offer_players
                        }
                    ];
                    const team_ids = Object.values(trade_offer).map((x)=>x.team_id);
                    const teams = await client.db(local_config.db).collection('teams').find(util.mongo_or_array('_id',team_ids)).toArray();
                    Object.values(trade_offer).forEach((c) => c.team = teams.find((t)=>t._id.equals(c.team_id)));
                    const trade_comp = (comp) => {
                        let m = `The ${comp.team.team_name} Send:\n`;
                        comp.players.forEach((p) => m += `    ${p}\n`);
                        return m;
                    };
                    let msg = `A trade has been completed between the ${trade_offer[0].team.team_name} and the ${trade_offer[1].team.team_name}.\n`;
                    msg += trade_comp(trade_offer[0]) + '\n';
                    msg += trade_comp(trade_offer[1]);
                    await send_msg(msg);
                }
            };
            const fn = tx_handlers[tx.transaction_type];
            if (fn) {
                await fn();
            } else {
                console.log(`Unknown transaction_type ${tx.transaction_type}`);
            }
        }
    }
}

const process_document = async (client, document, local_config) => {
    if (global.dev_mode) {
        console.log(`process_document(${document._id},${local_config.db})`);
    }

    const d = async () => {
        const r = await client.db(local_config.db).collection('discord').deleteOne({_id:document._id});
        util.assert(r.deletedCount == 1);
    };
    if (!global.dev_mode)
        await d();

    const timediff_ms = (new Date()).getTime() - document.insert_time.getTime();
    const timediff_hours = timediff_ms / 1000 / 60 / 60;
    if (timediff_hours < 6) {
        await process_document_remove_roles(client, document, local_config);
        await process_document_add_roles(client, document, local_config);
        await process_document_messages(client, document);
        await process_document_transactions(client, document, local_config);
    } else {
        console.log(`Document ${timediff_hours.toFixed(2)} hours old, not processing`);
    }

    if (global.dev_mode)
        await d();
};

const update_slash_commands = async () => {
    const rest = new REST().setToken(config.discord_client_token);
    const commands = discord.commands.map(c=>c.data.toJSON());
    await rest.put(Routes.applicationCommands(config.bot.client_id), {body:commands});
    console.log("Slash Commands Updated");
};

const update_guild_members = async (client, guild_id) => {
    const last_updated = (await cvar.get(client, 'guild_member_update_date', new Date(0))).getTime();
    const now_time = (new Date()).getTime();
    const time_diff = 1000 * 60 * 60 * 8; // Update Member List every 8 hours
    if (now_time - last_updated > time_diff) {
        console.log(`Updating Guild ${guild_id} for ${config.db}:`);
        const stored_member_ids = (await client.db(config.db).collection('guild_members').find({}).toArray())
            .map((x)=>x.userId);
        const guild = await discord.guilds.fetch(guild_id);
        const current_members = Array.from(await guild.members.fetch());
        const add_members = [];
        const remove_members = [];
        const update_members = [];
        current_members.forEach((member) => {
            const member_id = member[0];

            if (stored_member_ids.includes(member_id)) {
                update_members.push(member[1].toJSON());
            } else {
                add_members.push(member[1].toJSON());
            }
        });
        stored_member_ids.forEach((member_id) => {
            if (!current_members.find((m)=>m[0]==member_id)) { 
                remove_members.push(member_id);
            }
        });

        if (add_members.length > 0) {
            await client.db(config.db).collection('guild_members').insertMany(add_members);
            console.log(`...Added ${add_members.length} new members`);
        }

        if (remove_members.length > 0) {
            const remove_users = (await client.db(config.db).collection('users').find(util.mongo_or_array('user_id',remove_members))
                .toArray()).filter((u) => delete u._id);
            if (remove_users.length > 0) {
                console.log(`...Removing ${remove_users.length} Users and moving to deleted_users`);
                await client.db(config.db).collection('users').deleteMany(util.mongo_or_array('user_id',remove_members));
                await client.db(config.db).collection('deleted_users').insertMany(remove_users);
            }

            console.log(`...Removing ${remove_members.length} members from guild_members`);
            await client.db(config.db).collection('guild_members').deleteMany(util.mongo_or_array('userId',remove_members));
        }

        let member_update_count = 0;
        for (let u = 0;u < update_members.length; ++u) {
            const update_member = update_members[u];
            const userId = update_member.userId;
            delete update_member.userId;
            const r = await client.db(config.db).collection('guild_members').updateOne({userId},
                {$set:update_member});
            member_update_count += r.modifiedCount;
        }
        console.log(`...Updated ${member_update_count} existing members`);

        // set timeout
        await cvar.set(client, 'guild_member_update_date', new Date());
        console.log('Guild Members Updated');
    }
};

discord.once(Events.ClientReady, dclient => {
    console.log(`Logged In As ${dclient.user.tag}`);
    let c = 0;

    setIntervalAsync(async () => {
        if (global.dev_mode) {
            console.log(`setIntervalAsync(${c++})`);
        }

        try {
            const client = await db.client();
            const slash_version = await client.db(config.db).collection('cvars').findOne({name:'bot_slash_command_version'});
            if (!slash_version || slash_version.value != bot_slash_command_version) {
                await update_slash_commands();
                if (!slash_version) {
                    await client.db(config.db).collection('cvars').insertOne({name:'bot_slash_command_version',value:bot_slash_command_version});
                } else {
                    await client.db(config.db).collection('cvars').updateOne({name:'bot_slash_command_version'},
                        {$set:{value:bot_slash_command_version}});
                }
            }

            for (const name in config.bot.sites) {
                const local_config = config.bot.sites[name];
                config.db = local_config.db;

                if (!config.db) {
                    throw new Error("config.db not set");
                }

                try {
                    await update_guild_members(client, local_config.guild_id);
                } catch(e) {
                    console.log(`Exception ${e.toString()} updating ${name}`);
                }

                // process documents
                const documents = await client.db(config.db).collection('discord').find({}).sort({insert_date:-1}).toArray();
                for (let d = 0;d < documents.length;d++) {
                    await process_document(client, documents[d], local_config);
                }
            }
            await client.close();
        } catch (err) {
            console.error(err.toString());
        }
    }, 2500);
})

discord.on(Events.InteractionCreate, async interaction => {
    if (interaction.isChatInputCommand()) {
        const command = interaction.client.commands.get(interaction.commandName);
        if (command) {
            try {
                await command.execute(interaction);
            } catch(err) {
                console.log(err);
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({content:'Command Error', ephemeral: true});
                } else {
                    await interaction.reply({content: 'Command Error', ephemeral: true});
                }
            }
        }
    }
})

const register_commands = async () => {
    const client = await db.client();

    discord.commands = new Collection();
    await cmd_team.register_command(client, discord.commands);

    await client.close();
};

register_commands().then(() => discord.login(config.discord_client_token));
