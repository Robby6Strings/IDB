import "./style.css"
import { model, Field, idb } from "async-idb-orm"

const users = model({
  id: Field.number({ primaryKey: true }),
  name: Field.string({ default: "John Doe" }),
  age: Field.number({ index: true }),
  birthday: Field.date({ default: () => new Date(), optional: true }),
  pets: Field.array(
    model({
      name: Field.string(),
      age: Field.number(),
      species: Field.string({ optional: true }),
      birthday: Field.date({ default: () => new Date() }),
    })
  ),
  alive: Field.boolean(),
})

users.on("beforewrite", console.log)

users.on("beforedelete", console.log)

users.on("delete", console.log)

users.on("write", console.log)

const db = idb("demo", { users })

db.users.clear()

db.users
  .create({
    id: 1,
    age: 25,
    pets: [
      {
        name: "Fido",
        age: 1,
        species: "dog",
      },
    ],
    alive: true,
  })
  .then((user) => {
    console.log(user)
  })

db.users
  .create({
    id: 2,
    age: 25,
    pets: [
      {
        name: "Fido",
        age: 1,
        species: "dog",
      },
    ],
    alive: true,
  })
  .then((user) => {
    console.log(user)
  })
