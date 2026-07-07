const usePostgres = Boolean(process.env.DATABASE_URL);

module.exports = usePostgres ? require("./db-pg") : require("./db-json");
