module.exports = {
  async up(db, client) {
    await db.createCollection('industry');

  },

  async down(db, client) {
    await db.collection('industry').drop();
  }
};
