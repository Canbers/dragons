module.exports = {
  async up(db, client) {
    await db.createCollection('regions');

  },

  async down(db, client) {
    await db.collection('regions').drop();
  }
};
