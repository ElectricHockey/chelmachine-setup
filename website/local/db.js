const { MongoClient } = require("mongodb");
const config = global.config;

const mongo_port = process.env.MONGODB_PORT ? process.env.MONGODB_PORT : '27017';

const db_port = function() {
    return mongo_port;
}

const client = async function() {
    const mongo_url = `mongodb://localhost:${mongo_port}`;
    const out_client = new MongoClient(mongo_url);
    await out_client.connect();

    // Send a ping to confirm a successful connection
    //await client.db("admin").command({ ping: 1 });
    //console.log("Pinged your deployment. You successfully connected to MongoDB!2");
    return out_client;
}

const site_stats = async function(client) {
    const stats_out = {};
    const db = client.db(config.db);

    stats_out.num_matches = await db.collection('matches').count();

    return stats_out;
}

module.exports = {
    client,
    db_port,
    site_stats,
};