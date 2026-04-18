from datetime import datetime, timedelta
from sshtunnel import SSHTunnelForwarder
from pymongo import MongoClient
import sys
import requests

ip_chelmachine = '127.0.0.1' # IP of ChelMachine cloud service goes here
base_url = "https://proclubs.ea.com/api/nhl"
platform = "common-gen5"
headers={
    'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/119.0',
    'Accept': 'text/html,application/xhtml+xml,application/xml',
    'Accept-Language': 'en-US,en',
    'Accept-Encoding': 'gzip, deflate, br',
    'Content-Type': 'application/json',
    'Connection': 'keep-alive'
}
matchType = "club_private"

def get_json(url):
    r = requests.get(url, headers=headers, timeout=5)
    if r.status_code == 500:
        return []
    elif r.status_code != 200:
        raise RuntimeError(f"Invalid status code {r.status_code}")
    return r.json()

def insert_team_matches(client, db, club_id):
    if club_id == 0:
        print(f'Skipping club due to invalid ID {club_id}')
        return
    request_url = f"{base_url}/clubs/matches?clubIds={club_id}&platform={platform}&matchType={matchType}"
    print(f"Getting private matches for Db {db} Club {club_id} at {request_url}")
    j = get_json(request_url)

    for match in j:
        match_id = match['matchId']
        collection_matches = client[db]['matches']
        existing_match = collection_matches.find_one({'matchId':match_id})
        if existing_match is not None:
            print(f'Match {match_id} already exists in db {db}, skipping')
        else:
            print(f'Inserting Match {match_id} into {db}')
            collection_matches.insert_one(match)

def get_teams_for_games_in_range(db_name, before_time, after_time):
    games = list(client[db_name]['schedules'].find({
        '$and': [
            {'date':{'$gte':before_time}},
            {'date':{'$lte':after_time}}
        ]
    }))
    print(f'Found {len(games)} recent games for db {db_name}, resolving teams')
    teams = {}
    for game in games:
        teams[game['away_club_id']] = 1
        teams[game['home_club_id']] = 1

        db_teams = client[db_name]['teams'].find({'$or': [
                {'_id': game['away_team_id']},
                {'_id': game['home_team_id']}
            ]})
        for dbt in db_teams:
            teams[dbt['team_id']] = 1
    return list(teams)

def get_matches(client):
    db_names = client.list_database_names()
    current_time = datetime.now()
    day_range = 1.5
    before_time = current_time - timedelta(days=day_range)
    after_time = current_time + timedelta(days=day_range)

    for db_name in db_names:
        collection_names = client[db_name].list_collection_names()
        if 'teams' in collection_names and 'schedules' in collection_names:
            teams = get_teams_for_games_in_range(db_name, before_time, after_time)
            print(f'Resolved {len(teams)} teams for db {db_name}')
            for team_id in teams:
                insert_team_matches(client, db_name, team_id)


if __name__ == '__main__':
    print(f"Starting Chel Machine EA NHL API Scraper {datetime.now()}")
    print("=============================================")

    vi = sys.version_info
    if vi.major != 3 and vi.minor < 8:
        raise RuntimeError(f"Python must be 3.8 or greater, version is {vi}")
    
    use_tunnel = True
    mongo_port = 27017
    if use_tunnel:
        print(f'Connecting to Chel Machine DB @ {ip_chelmachine}')
        server = SSHTunnelForwarder(ip_chelmachine, ssh_username='root', remote_bind_address=('127.0.0.1', 27017))
        server.start()
        mongo_port = server.local_bind_port
    client = MongoClient('127.0.0.1', mongo_port)
    get_matches(client)

    client.close()
    if use_tunnel:
        server.stop()
