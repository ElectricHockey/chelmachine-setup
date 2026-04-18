const path = require('path');
global.dev_mode = (process.env.CHELMACHINE_DEV == 1) ? true : false;
global.site = process.env.CHELMACHINE_SITE ? process.env.CHELMACHINE_SITE : 'default';
global.config = require(`./config.${global.site}.json`);
global.root_dir = path.resolve(__dirname);
global.upload_limit = '25mb';

const config = global.config;
const createError = require('http-errors');
const express = require('express');
const cookieParser = require('cookie-parser');
const logger = require('morgan');
const db = require('./local/db');
const session = require('express-session');
const mongo_store = require('connect-mongo');
const cors = require('cors');
const passport = require('passport');
const favicon = require('serve-favicon');
const file_upload = require('express-fileupload');
const upgrade = require('./local/upgrade');

upgrade.init();

console.log(`Website ${global.site} started at ${new Date()}, dev_mode ${global.dev_mode}`);

const app = express();
app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.use(cors());
app.use(file_upload());

// session setup
const session_info = {
  secret: process.env.SESSION_SECRET || '2DdMqcSPd8gQpmnMn-rR3gGVMFulTtDD',
  cookie: {},
  resave: false,
  saveUninitialized: false,
  store: mongo_store.create({ mongoUrl: process.env.MONGO_URL || `mongodb://localhost:${db.db_port()}/${config.db}` }),
};

if (app.get('env') === 'production') {
  app.set('trust proxy', 1);
  const on_except = async (err) => {
    const client = await db.client();
    await client.db(config.db).collection('exceptions').insertOne({
      source: 'website',
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

app.use(session(session_info));
app.use(passport.session());

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'pug');

app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({extended: true, limit: global.upload_limit, parameterLimit: 5000}));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', require('./routes/index'));
app.use('/admin', require('./routes/admin'));
app.use('/front_office', require('./routes/front_office'));
app.use('/game', require('./routes/game'));
app.use('/login', require('./routes/login'));
app.use('/messages', require('./routes/messages'));
app.use('/offer', require('./routes/offer'));
app.use('/player', require('./routes/player'));
app.use('/player_stats', require('./routes/player_stats'));
app.use('/profile', require('./routes/profile'));
app.use('/rulebook', require('./routes/rulebook'));
app.use('/schedule', require('./routes/schedule'));
app.use('/standings', require('./routes/standings'));
app.use('/team', require('./routes/team'));
app.use('/team_stats', require('./routes/team_stats'));
app.use('/terms', require('./routes/terms'));
app.use('/trophy_case', require('./routes/trophy_case'));
app.use('/auth', require('./routes/auth_discord'));

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) { // eslint-disable-line no-unused-vars
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
