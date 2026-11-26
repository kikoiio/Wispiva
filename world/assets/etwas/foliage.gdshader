shader_type spatial;
render_mode cull_disabled, specular_disabled;

varying vec3 world_pos;

void vertex() {
	world_pos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
	float gust = sin(world_pos.x * 0.43 + world_pos.z * 0.24 + TIME * 1.46);
	VERTEX.x += 0.028 * gust;
	VERTEX.z += 0.016 * gust;
}

void fragment() {
	float needles = sin(world_pos.y * 25.0 + sin(world_pos.x * 19.0) * 1.2) * 0.035;
	vec3 pigment = COLOR.rgb * (0.92 + needles);
	ALBEDO = OUTPUT_IS_SRGB ? pow(pigment, vec3(1.0 / 2.2)) : pigment;
	ROUGHNESS = 0.97;
}
