module.exports = {
  async up(db, client) {
    await db.createCollection('settlements');

  },

  async down(db, client) {
    await db.collection('settlements').drop();
  }
};
