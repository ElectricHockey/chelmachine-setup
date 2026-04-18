const { PutObjectCommand, S3 } = require("@aws-sdk/client-s3");

const endpoint = '';
const origin = '';
const accessKeyId = '';
const secretAccessKey = '';

const make_uuid = () => {
    let d = new Date().getTime();
    const uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = (d + Math.random()*16)%16 | 0;
        d = Math.floor(d/16);
       return (c=='x' ? r : (r&0x3|0x8)).toString(16);
    });
    return uuid;
}

const upload = async function(fd) {
    const ext = () => fd.mimetype.endsWith('jpeg') ? fd.mimetype.slice(-4) : fd.mimetype.slice(-3)
    const relpath = `${make_uuid()}.${ext()}`;
    const client = new S3({
        forcePathStyle: false, // Configures to use subdomain/virtual calling format.
        endpoint,
        region: "us-east-1",
        credentials: {
          accessKeyId,
          secretAccessKey,
        }
    });
    const command = new PutObjectCommand({
        ACL:'public-read',
        Bucket: "chelmachine",
        Key: relpath,
        Body: fd.data,
        Metadata: {
            encoding: fd.encoding,
            md5: fd.md5,
            mimetype: fd.mimetype,
            name: fd.name,
            size: fd.size.toString()
        }
    });
    try {
        const response = await client.send(command);
        console.log(response);
    } catch (err) {
        console.error(err);
    }
    return `${origin}${relpath}`;
}

module.exports = {
    upload
}
