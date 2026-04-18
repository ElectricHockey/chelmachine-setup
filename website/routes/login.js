const express = require('express');
const router = express.Router();

router.get('/', async function(req, res) {
  res.set('Access-Control-Allow-Origin', '*');
  if (req.query.logout === 'true') {
    req.session.destroy();
    res.redirect('/?status=Logout+Successful');
    return;
  }
  res.redirect('/');
});

router.get('/failed', function(req, res) {
  res.redirect('/?status=Login+Failed');
});

module.exports = router;
