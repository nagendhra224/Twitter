const express = require("express");
const path = require("path");
const { open } = require("sqlite");
const sqlite3 = require("sqlite3");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const app = express();
app.use(express.json());
const dbPath = path.join(__dirname, "twitterClone.db");
let db = null;

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    app.listen(3000, () => {
      console.log("Server Running at http://localhost:3000/");
    });
  } catch (e) {
    console.log(`DB Error: ${e.message}`);
    process.exit(1);
  }
};
initializeDBAndServer();

const authenticateToken = (request, response, next) => {
  const { tweet } = request.body;
  const { tweetId } = request.params;
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    jwt.verify(jwtToken, "MY_SECRET_TOKEN", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.payload = payload;
        request.tweetId = tweetId;
        request.tweet = tweet;
        next();
      }
    });
  }
};

const tweetsAccessVerification = async (request, response, next) => {
  const { user_id } = request;
  const { tweetId } = request;
  const getTweetQuery = `select * from tweet inner join follower on tweet.user_id=follower.following_user_id
    where tweet.tweet_id="${tweetId}" and follower_user_id="${user_id}";`;
  const tweet = await db.get(getTweetQuery);
  if (tweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

app.post("/register", async (request, response) => {
  const { username, name, password, gender } = request.body;
  const selectUserQuery = `
  select * from user where username="${username}";`;
  console.log(username, password, name, gender);
  const dbUser = await db.get(selectUserQuery);
  if (dbUser === undefined) {
    if (password.length < 6) {
      response.status(400);
      response.send("Password is too short");
    } else {
      const hashedPassword = await bcrypt.hash(password, 10);
      const createUserQuery = `
      insert into user
      (username,name,password,gender)
      values(
          '${username}',
          '${name}',
          '${hashedPassword}',
          '${gender}'
      ) ;`;
      await db.run(createUserQuery);
      response.status(200);
      response.send("User created successfully");
    }
  } else {
    response.status(400);
    response.send("User already exists");
  }
});

app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const selectUserQuery = `
  SELECT 
    * 
  FROM 
    user 
  WHERE 
    username = '${username}'`;
  console.log(username.password);
  const dbUser = await db.get(selectUserQuery);
  console.log(dbUser);
  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      const jwtToken = jwt.sign(dbUser, "MY_SECRET_TOKEN");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});
app.get("/user/tweets/feed", authenticateToken, async (request, response) => {
  const { payload } = request;
  const { user_id, name, username, gender } = payload;
  console.log(name);
  const getTweetsFeedQuery = `
    select username,tweet,date_time as dateTime
    from follower inner join tweet on follower.following_user_id=tweet.user_id inner join user 
    on user.user_id=follower.following_user_id where follower.follower_user_id=${user_id}
    order by date_time DESC
    limit 4;`;
  const tweetFeedArray = await db.all(getTweetsFeedQuery);
  response.send(tweetFeedArray);
});
app.get("/user/following", authenticateToken, async (request, response) => {
  const { payload } = request;
  const { user_id, name, username, gender } = payload;
  console.log(name);
  const userFollowsQuery = `
    select name from user inner join follower on user.user_id=follower.following_user_id
    where follower.follower_user_id=${user_id};`;
  const userFollowsArray = await db.all(userFollowsQuery);
  response.send(userFollowsArray);
});
app.get("/user/followers", authenticateToken, async (request, response) => {
  const { payload } = request;
  const { user_id, name, username, gender } = payload;
  console.log(name);
  const userFollowersQuery = `
     select name from user inner join follower on user.user_id=follower.follower_user_id
     where follower.following_user_id=${user_id};`;
  const userFollowersArray = await db.all(userFollowersQuery);
  response.send(userFollowersArray);
});
app.get("/tweets/:tweetId/", authenticateToken, async (request, response) => {
  const { tweetId } = request;
  const { payload } = request;
  const { user_id, name, username, gender } = payload;
  const tweetsQuery = `select * from tweet where tweet_id=${tweetId};`;
  const tweetsResult = await db.get(tweetsQuery);
  const userFollowersQuery = `
      select * from follower inner join user on user.user_id=follower.following_user_id
      where follower.follower_user_id=${user_id};`;
  const userFollowers = await db.all(userFollowersQuery);
  if (
    userFollowers.some(
      (item) => item.following_user_id === tweetsResult.user_id
    )
  ) {
    const getTweetDetailsQuery = `
          select tweet,count(distinct(like.lik_id)) as likes,
          count(distinct(reply.reply_id)) as replies,
          tweet.date_time as dateTime from tweet inner join like on tweet.tweet_id =like.tweet_id inner join
          reply on reply.tweet_id=tweet.tweet_id 
          where tweet.tweet_id=${tweetId} and tweet.user_id=${userFollowers[0].user_id};`;
    const tweetDetails = await db.get(getTweetDetailsQuery);
    response.send(tweetDetails);
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

app.get(
  "/tweets/:tweetId/likes",
  authenticateToken,
  tweetsAccessVerification,
  async (request, response) => {
    const { tweetId } = request.params;
    const getLikedUsersQuery = `
    select username from user inner join like on user.user_id=like.user_id
    where tweet_id="${tweetId}";`;
    const likedUsers = await db.all(getLikedUsersQuery);
    const userArray = likedUsers.map((eachUser) => eachUser.username);
    response.send({ likes: userArray });
  }
);
app.get(
  "/tweets/:tweetId/replies",
  authenticateToken,
  async (request, response) => {
    const { tweetId } = request;
    const { payload } = request;
    const { user_id, name, username, gender } = payload;
    console.log(name, tweetId);
    const getRepliedUsersQuery = `
    select * from follower inner join tweet on tweet.user_id =follower.following_user_id inner join reply
    on reply.tweet_id=tweet.tweet_id inner join user on user.user_id=reply.user_id
    where tweet.tweet_id=${tweetId} and follower.follower_user_id=${user_id};`;
    const repliedUsers = await db.all(getRepliedUsersQuery);
    console.log(repliedUsers);
    if (repliedUsers.length !== 0) {
      let replies = [];
      const getNamesArray = (repliedUsers) => {
        for (let item of repliedUsers) {
          let object = {
            name: item.name,
            reply: item.reply,
          };
          replies.push(object);
        }
      };
      getNamesArray(repliedUsers);
      response.send({ replies });
    } else {
      response.status(401);
      response.send("Invalid Request");
    }
  }
);
app.get("/user/tweets", authenticateToken, async (request, response) => {
  const { payload } = request;
  const { user_id, name, username, gender } = payload;
  console.log(name, user_id);
  const getTweetsDetailsQuery = `
     select tweet.tweet as tweet,
     count(distinct(like.like_id)) as likes,
     count(distinct(reply.reply_id)) as replies,
     tweet.date_time as dateTime 
     from user inner join tweet on user.user_id =tweet.user_id inner join like on like.tweet_id=tweet.tweet_id inner join
     reply  on reply.tweet_id=tweet.tweet_id where user.user_id=${user_id}
     group by tweet.tweet_id;`;
  const tweetsDetails = await db.all(getTweetsDetailsQuery);
  response.send(tweetsDetails);
});
app.post("/user/tweets", authenticateToken, async (request, response) => {
  const { tweet } = request;
  const { tweetId } = request;
  const { payload } = request;
  const { user_id, name, username, gender } = payload;
  console.log(name, tweetId);
  const postTweetQuery = `
    insert into tweet (tweet,user_id) values ("${tweet}",
    "${user_id}");`;
  await db.run(postTweetQuery);
  response.send("Created a Tweet");
});
app.delete("/tweets/:tweetId", authenticateToken, async (request, response) => {
  const { tweetId } = request;
  const { payload } = request;
  const { user_id, name, username, gender } = payload;
  const selectUserQuery = `
     select * from tweet where tweet.user_id=${user_id} and tweet.tweet_id=${tweetId};`;
  const tweetUser = await db.all(selectUserQuery);
  if (tweetUser.length !== 0) {
    const deleteTweetQuery = `
         delete from tweet where tweet.user_id=${user_id} and tweet.tweet_id=${tweetId};`;
    await db.run(deleteTweetQuery);
    response.send("Tweet Removed");
  } else {
    response.status(401);
    response.send("Invalid Request");
  }
});

module.exports = app;
