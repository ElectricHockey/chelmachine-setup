const config = global.config;

const delete_messages = async function(client, user_id) {
    await client.db(config.db).collection('messages').deleteMany({user_id});
}

const get_messages = async function(client, user_id) {
    return await client.db(config.db).collection('messages').find({user_id}).sort({time:-1}).toArray();
}

const mark_messages_read = async function(client, user_id) {
    await client.db(config.db).collection('messages').updateMany({user_id},{$set:{read: true}});
}

const has_unread_messages = async function(client, user_id) {
    const filter = { user_id, read: { $exists: false } };
    const message = await client.db(config.db).collection('messages').findOne(filter);
    return message ? true : false;
}

module.exports = {
    delete_messages,
    get_messages,
    mark_messages_read,
    has_unread_messages
}
