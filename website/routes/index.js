const express = require('express');
const router = express.Router();
const view_config = require('../local/view_config');
const db = require('../local/db');
const markdown = require('../local/markdown');
const playoffs = require('../local/playoffs');
const seasons = require('../local/seasons');
const teams = require('../local/teams');

/* GET home page. */
router.get('/', async function(req, res) {
  const client = await db.client();
  const render_locals = await view_config.get(client, req);
  const indexmd = await markdown.latest_md(client, 'index');
  if (indexmd) {
    render_locals.indexmd = markdown.render(indexmd.content);
  }
  
  render_locals.seasons = await seasons.get_seasons(client);
  render_locals.playoffs = [];
  render_locals.teams = [];
  if (render_locals.seasons) {
    for (let s = 0;s < render_locals.seasons.length;s++) {
      const season = render_locals.seasons[s];
      const series = await playoffs.playoff_series_for_season(client, season.season_id);

      if (series.length == 0)
        continue;

      const now = new Date();
      if (!series.find((s) => {
        if (s.games) {
          return s.games.find((g) => {
            const gdate = g.date;
            const dmilliseconds = now.getTime() - gdate.getTime();
            const dseconds = dmilliseconds / 1000;
            const dminutes = dseconds / 60;
            const dhours = dminutes / 60;
            const ddays = dhours / 24;
            return ddays < 21;
          });
        } else {
          return true;
        }
      })) {
        continue;
      }

      series.season = season;
      render_locals.playoffs.push(series);
      render_locals.teams.push(...(await teams.season_teams(client, season.season_id)));
    }
  }
  res.render('index', render_locals);
  await client.close();
});

module.exports = router;
