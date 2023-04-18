module.exports = {
  async up(db, client) {
    await db.createCollection('plot');

  },

  async down(db, client) {
    await db.collection('plot').drop();
  }
};