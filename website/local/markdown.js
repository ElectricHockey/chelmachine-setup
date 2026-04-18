const md = require('markdown-it')({html: true});
const config = global.config;

const latest_md = async (client, coll) => (await client.db(config.db).collection(coll).find().sort({insert_date: -1}).limit(1).toArray())[0]

const render = (mdcontent) => md.render(mdcontent);

module.exports = {
    render,
    latest_md
}