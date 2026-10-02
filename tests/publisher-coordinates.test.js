import test from "node:test";
import assert from "node:assert/strict";
import {publisherCoordinates,signedCoordinate} from "../src/core/coordinates.js";
const page = (street, lat=40.59537, lng=-105.02782) => '<script type="application/ld+json">'+JSON.stringify({"@graph":[{address:{streetAddress:street},geo:{latitude:lat,longitude:lng}}]})+'</script>';
test("publisher coordinates retain western longitude and match unit variants",()=>{
 assert.deepEqual(publisherCoordinates(page("2702 Barnstormer Street"),"2702 Barnstormer St Unit A, Fort Collins, CO"),{lat:40.59537,lng:-105.02782});
});
test("coordinates from another property or invalid values are rejected",()=>{
 assert.equal(publisherCoordinates(page("2704 Barnstormer St"),"2702 Barnstormer St"),null);
 assert.equal(publisherCoordinates(page("2702 Barnstormer St",null),"2702 Barnstormer St"),null);
 assert.equal(signedCoordinate("",180),null);
 assert.equal(signedCoordinate(-181,180),null);
});
