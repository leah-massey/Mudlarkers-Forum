import fastify from "fastify";
import dotenv from "dotenv";
import sensible from "@fastify/sensible";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import { PrismaClient } from "@prisma/client";
dotenv.config();

const app = fastify();
app.register(sensible);
app.register(cookie, { secret: process.env.COOKIE_SECRET });
app.register(cors, {
  // the origin we're making our request from
  origin: process.env.CLIENT_URL,
  credentials: true,
});

// // fastify middleware
app.addHook("onRequest", (req, res, done) => {
  if (req.cookies.userId !== CURRENT_USER_ID) {
    req.cookies.userId = CURRENT_USER_ID;
    res.clearCookie("userId");
    res.setCookie("userId", CURRENT_USER_ID);
  }
  done();
});

const prisma = new PrismaClient();
// this is faking who we're logged in as (Benny!)
const CURRENT_USER_ID = (
  await prisma.user.findFirst({ where: { name: "Sidney" } })
).id;

const COMMENT_SELECT_FIELDS = {
  id: true,
  message: true,
  parentId: true,
  createdAt: true,
  user: {
    select: {
      id: true,
      name: true,
    },
  },
};

//retrieve all posts
app.get("/posts", async (req, res) => {
  return await commitToDb(
    prisma.post.findMany({
      select: {
        id: true,
        title: true,
      },
    })
  );
});

// retrieve a specific post
app.get("/posts/:id", async (req, res) => {
  return await commitToDb(
    prisma.post
      .findUnique({
        where: {
          id: req.params.id,
        },
        select: {
          body: true,
          title: true,
          comments: {
            orderBy: {
              createdAt: "desc",
            },
            select: {
              ...COMMENT_SELECT_FIELDS,
              _count: { select: { likes: true } },
            },
          },
        },
      })
      .then(async (post) => {
        const likes = await prisma.like.findMany({
          where: {
            userId: req.cookies.userId,
            commentId: { in: post.comments.map((comment) => comment.id) },
          },
        });
        return {
          ...post,
          comments: post.comments.map((comment) => {
            const { _count, ...commentFields } = comment;
            return {
              ...commentFields,
              likedByMe: likes.find((like) => like.commentId === comment.id),
              likeCount: _count.likes,
            };
          }),
        };
      })
  );
});

// make a comment on a specific post
app.post("/posts/:id/comments", async (req, res) => {
  if (req.body.message === "" || req.body.message == null) {
    return res.send(app.httpErrors.badRequest("Message is required"));
  }
  return await commitToDb(
    prisma.comment
      .create({
        data: {
          message: req.body.message,
          userId: req.cookies.userId,
          parentId: req.body.parentId,
          postId: req.params.id,
        },
        select: COMMENT_SELECT_FIELDS,
      })
      .then((comment) => {
        return {
          ...comment,
          // a new comment has no likes by anyone
          likeCount: 0,
          likedByMe: false,
        };
      })
  );
});

// update a comment on a specific post
app.put("/posts/:postId/comments/:commentId", async (req, res) => {
  //error message if message body is empty
  if (req.body.message === "" || req.body.message == null) {
    return res.send(app.httpErrors.badRequest("Message is required"));
  }

  //identify the userId connected to the post
  const { userId } = await prisma.comment.findUnique({
    where: { id: req.params.commentId },
    select: { userId: true },
  });
  //check that userId of post matches the id of the user doing the update
  if (userId !== req.cookies.userId) {
    return res.send(
      app.httpErrors.unauthorized(
        "You do not have permission to edit this message"
      )
    );
  }
  return await commitToDb(
    prisma.comment.update({
      where: {
        id: req.params.commentId,
      },
      data: {
        message: req.body.message,
      },
      select: {
        message: true,
      },
    })
  );
});

//delete a comment on a specific post
app.delete("/posts/:postId/comments/:commentId", async (req, res) => {
  //identify the userId connected to the post
  const { userId } = await prisma.comment.findUnique({
    where: { id: req.params.commentId },
    select: { userId: true },
  });
  //check that userId of post matches the id of the user attempting the update
  if (userId !== req.cookies.userId) {
    return res.send(
      app.httpErrors.unauthorized(
        "You do not have permission to delete this message"
      )
    );
  }

  return await commitToDb(
    prisma.comment.delete({
      where: {
        id: req.params.commentId,
      },
      select: {
        id: true,
      },
    })
  );
});

// helper function error handling which takes a promise applied to above requests
//app.to is part of fastify/sensible library
async function commitToDb(promise) {
  const [error, data] = await app.to(promise);
  if (error) return app.httpErrors.internalServerError(error.message);
  return data;
}

app.listen({ port: process.env.PORT });
