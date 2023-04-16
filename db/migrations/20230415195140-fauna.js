module.exports = {
  async up(db, client) {
    await db.createCollection('fauna');

  },

  async down(db, client) {
    await db.collection('fauna').drop();
  }
};
