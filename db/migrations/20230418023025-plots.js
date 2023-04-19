module.exports = {
  async up(db, client) {
    await db.createCollection('plots');

  },

  async down(db, client) {
    await db.collection('plots').drop();
  }
};