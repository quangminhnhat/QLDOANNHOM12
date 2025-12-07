const LocalStrategy = require("passport-local").Strategy;
const bcrypt = require("bcrypt");



function initalize(passport, getUserByEmail, getUserById) {
  const authenticateUser = async (email, password, done) => {
    const user = await getUserByEmail(email); // Replace with your user retrieval logic
    console.log("User retrieved:", user);
    if (user == null) {
      return done(null, false, { message: "No user with that email" });
    }
    try {
      if (
        await bcrypt.compare(
          password,
          user.password
        )
      ) {
        return done(null, user);
      } else {
        return done(null, false, { message: "Password incorrect" });
      }
    } catch (error) {
      console.error("Error during user retrieval:", error);
      return done(error);
    }
  };

  passport.use(new LocalStrategy({ usernameField: "email" }, authenticateUser));
  passport.serializeUser((user, done) => done(null, user.id));
 passport.deserializeUser(async (id, done) => {
   try {
     const user = await getUserById(id); 
     done(null, user);
   } catch (error) {
     done(error);
   }
 });
}


module.exports = initalize;