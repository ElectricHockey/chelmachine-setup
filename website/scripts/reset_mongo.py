from datetime import datetime, timedelta
from pymongo import MongoClient
import sys

def reset_mongo_shard():
    print("Opening DB Connection...")
    mongo_port = 27017
    client = MongoClient('127.0.0.1', mongo_port)

    db_names = client.list_database_names()

    for db_name in db_names:
        skip_names = ["admin","config"]
        if db_name in skip_names:
            continue

        print(f"Deleting {db_name}...")
        client.drop_database(db_name)

    print("Closing DB Connection...")
    client.close()
    

if __name__ == '__main__':
    print(f"Reset Mongo DB Script Running At: {datetime.now()}")
    print("=============================================")

    vi = sys.version_info
    if vi.major != 3 and vi.minor < 8:
        raise RuntimeError(f"Python must be 3.8 or greater, version is {vi}")
    
    print("Press Y to Continue. WARNING: THIS WILL DESTROY ALL MONGO DB DATA!")
    r = input().upper()

    if r == 'Y':
        reset_mongo_shard()
    else:
        print("Exiting Program")
