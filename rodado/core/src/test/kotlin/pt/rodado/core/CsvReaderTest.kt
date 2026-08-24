package pt.rodado.core

import org.junit.jupiter.api.Test
import pt.rodado.core.csv.CsvReader
import kotlin.test.assertEquals

class CsvReaderTest {

    @Test
    fun `deteta ponto e virgula`() {
        val table = CsvReader.parse("Data;Valor;Distância\n05/09/2026;12,50;4,2\n")
        assertEquals(';', table.delimiter)
        assertEquals(listOf("Data", "Valor", "Distância"), table.headers)
        assertEquals(listOf("05/09/2026", "12,50", "4,2"), table.rows.single())
    }

    @Test
    fun `deteta virgula`() {
        val table = CsvReader.parse("date,amount,distance\n2026-09-05,12.50,4.2\n")
        assertEquals(',', table.delimiter)
        assertEquals(3, table.headers.size)
    }

    @Test
    fun `respeita aspas com separador e quebra de linha dentro`() {
        val text = "a,b\n\"Lisboa, Baixa\",\"linha 1\nlinha 2\"\n"
        val table = CsvReader.parse(text)
        assertEquals(listOf("Lisboa, Baixa", "linha 1\nlinha 2"), table.rows.single())
    }

    @Test
    fun `aspas duplicadas viram uma so`() {
        val table = CsvReader.parse("a\n\"diz \"\"ola\"\"\"\n")
        assertEquals("diz \"ola\"", table.rows.single().single())
    }

    @Test
    fun `ignora BOM e linhas vazias`() {
        val table = CsvReader.parse("﻿a;b\n1;2\n\n3;4\n")
        assertEquals(listOf("a", "b"), table.headers)
        assertEquals(2, table.rows.size)
    }

    @Test
    fun `aceita fim de linha do Windows`() {
        val table = CsvReader.parse("a;b\r\n1;2\r\n")
        assertEquals(listOf("1", "2"), table.rows.single())
    }
}
