module.exports = {
  async up(db, client) {
    await db.createCollection('flora');

  },

  async down(db, client) {
    await db.collection('flora').drop();
  }
};
