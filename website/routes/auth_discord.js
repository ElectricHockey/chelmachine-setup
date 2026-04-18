const discord_strategy = require('passport-discord').Strategy;
const passport = require('passport');
const express = require('express');
const router = express.Router();
const users = require('../local/users');
const db = require('../local/db');
const teams = require('../local/teams');
const config = global.config;
const seasons = require('../local/seasons');

const callback_url = config.auth.callback_url[global.dev_mode ? 'dev' : 'prod'];

passport.use(new discord_strategy({
    clientID: config.auth.client_id,
    clientSecret: config.auth.client_secret,
    callbackURL: callback_url,
    scope: ['identify','guilds.members.read']
  },
  async function(accessToken, refreshToken, profile, cb) {
    const client = await db.client();
    const success = await users.loggedin(client, profile);
    await client.close();
    if (!success) {
      return cb('Banned',profile);
    } else {
      return cb(null, profile);
    }
  }
));

passport.serializeUser(function(user, cb) {
  process.nextTick(function() {
    cb(null, user);
  });
});

passport.deserializeUser(function(user, cb) {
  process.nextTick(function() {
    return cb(null, user);
  });
});

router.get('/discord', passport.authenticate('discord'));

router.get('/discord/callback', 
  passport.authenticate('discord', { failureRedirect: '/?status=Login+Failed' }),
  async function(req, res) {
    res.set('Access-Control-Allow-Origin', '*');

    // check for admin credentials
    const client = await db.client();
    const user = await users.get_record(client, req.session.passport.user.id);
    const season_id = await seasons.current_season_id(client);
    if (user) {
      if (!user.banned) {
        if (user.admin === true) {
          req.session.admin = true;
        }
        if (user.stats === 'on') {
          req.session.stats = true;
        }
        if (user.transactions === 'on') {
          req.session.transactions = true;
        }
        if (user.disciplinary === 'on') {
          req.session.disciplinary = true;
        }
        if (user.gamertags) {
          req.session.gamertags = user.gamertags;
        }
        if (user.application && user.application.season_id == season_id) {
          req.session.application = true;
        }

        req.session.front_office_teams = await teams.teams_owned_by_user(client, user);
      }
    }

    // log IP address
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const iplog = { auth: user.auth, ip, user_id: user.user_id, time: new Date() };
    await client.db(config.db).collection('iplog').insertOne(iplog);

    await client.close();

    // Successful authentication, redirect home.
    res.redirect('/?status=Login+Successful');
  });

module.exports = router;
